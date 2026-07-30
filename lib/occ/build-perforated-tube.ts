import type { OC, ShapeHandle } from "./types";
import { makeCylinder } from "./geom-utils";

// Callback fired from inside the builder so the worker can forward a
// "building_part" progress event with a note like "Cortando 300/1380".
export type PerforatedProgress = (done: number, total: number) => void;

export type PerforatedTubeArgs = {
  outer_diameter_mm: number;
  wall_thickness_mm: number;
  length_mm: number;
  hole_diameter_mm: number;
  edge_gap_mm: number;
  end_margin_mm: number;
};

// Builds a hollow round tube perforated with a HEXAGONAL pattern of
// round holes (perforated tubes for filters / mufflers / dust
// collectors). OCC WASM is slow with many booleans, so we chunk the
// holes into batches of BATCH_SIZE, run one BRepAlgoAPI_Cut per
// batch, and call `onProgress` after each batch so the UI actually
// moves.
export function buildPerforatedTube(
  oc: OC,
  args: PerforatedTubeArgs,
  onProgress?: PerforatedProgress,
): { shape: ShapeHandle; hole_count: number } {
  const D = args.outer_diameter_mm;
  const wall = args.wall_thickness_mm;
  const length = args.length_mm;
  const holeD = args.hole_diameter_mm;
  const gap = args.edge_gap_mm;
  const margin = args.end_margin_mm;

  const rOuter = D / 2;
  const rInner = Math.max(rOuter - wall, 0.05);
  const holeR = holeD / 2;

  const outer = makeCylinder(oc, [0, 0, 0], [1, 0, 0], rOuter, length);
  const inner = makeCylinder(oc, [0, 0, 0], [1, 0, 0], rInner, length);
  let body = cutSingle(oc, outer, inner);

  const pitch = holeD + gap;
  const circumference = Math.PI * D;
  const nCirc = Math.max(1, Math.round(circumference / pitch));
  const arcPitchRad = (2 * Math.PI) / nCirc;
  const rowSpacing = pitch * (Math.sqrt(3) / 2);

  const firstRowX = margin + holeR;
  const lastRowX = length - margin - holeR;
  const usableLen = lastRowX - firstRowX;
  const nRows = Math.max(0, Math.floor(usableLen / rowSpacing) + 1);

  const overshoot = wall * 0.6 + 1;
  const drillLen = D + overshoot * 2;

  // Precompute all drill tools. Storing 1000+ ShapeHandles is fine —
  // they're WASM handles, not heavy meshes.
  const tools: ShapeHandle[] = [];
  for (let r = 0; r < nRows; r++) {
    const x = firstRowX + r * rowSpacing;
    const rowOffset = r % 2 === 0 ? 0 : arcPitchRad / 2;
    for (let c = 0; c < nCirc; c++) {
      const theta = c * arcPitchRad + rowOffset;
      const ny = Math.cos(theta);
      const nz = Math.sin(theta);
      const origin: [number, number, number] = [
        x,
        ny * (rOuter + overshoot),
        nz * (rOuter + overshoot),
      ];
      const axis: [number, number, number] = [0, -ny, -nz];
      tools.push(makeCylinder(oc, origin, axis, holeR, drillLen));
    }
  }

  const total = tools.length;
  const BATCH_SIZE = 40;
  onProgress?.(0, total);

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = tools.slice(i, i + BATCH_SIZE);
    const compound = buildCompound(oc, batch);
    body = cutSingle(oc, body, compound);
    onProgress?.(Math.min(i + BATCH_SIZE, total), total);
  }

  return { shape: body, hole_count: total };
}

function cutSingle(
  oc: OC,
  base: ShapeHandle,
  tool: ShapeHandle,
): ShapeHandle {
  const op = new oc.BRepAlgoAPI_Cut_3(base, tool);
  op.Build();
  return op.Shape();
}

function buildCompound(oc: OC, shapes: ShapeHandle[]): ShapeHandle {
  const compound = new oc.TopoDS_Compound();
  const builder = new oc.BRep_Builder();
  builder.MakeCompound(compound);
  for (const s of shapes) {
    builder.Add(compound, s);
  }
  return compound;
}

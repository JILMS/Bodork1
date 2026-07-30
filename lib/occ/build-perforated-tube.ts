import type { OC, ShapeHandle } from "./types";
import { makeCylinder } from "./geom-utils";

// Callback fired from inside the builder so the worker can forward a
// "batch_progress" event with a note like "Cortando 300/1380".
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
// round holes. Uses OCC's BATCHED Boolean API
// (BRepAlgoAPI_Cut with SetArguments/SetTools) so each cut processes
// hundreds of tools at once against the same argument — OCC builds
// the intersection graph once per batch instead of once per hole.
// We still chunk into a handful of batches so the UI shows progress.
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

  // Precompute all drill tools (WASM handles, not heavy meshes).
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
  // 500 tools per batch: OCC's batched Boolean API handles this in
  // ONE intersection-graph build, so wall-time per batch is roughly
  // constant, not O(N²) as it was with 40-tool compound cuts. With
  // ~1500 holes we get 3 progress updates, which is plenty.
  const BATCH_SIZE = 500;
  onProgress?.(0, total);

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = tools.slice(i, i + BATCH_SIZE);
    body = cutBatched(oc, body, batch);
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

// Batched Boolean cut: base − (tool1, tool2, …, toolN) using OCC's
// SetArguments/SetTools API. Much faster than repeated pairwise cuts
// because the pave filler / intersection graph is computed once.
function cutBatched(
  oc: OC,
  base: ShapeHandle,
  toolShapes: ShapeHandle[],
): ShapeHandle {
  const argsList = new oc.TopTools_ListOfShape_1();
  argsList.Append_1(base);

  const toolsList = new oc.TopTools_ListOfShape_1();
  for (const t of toolShapes) toolsList.Append_1(t);

  const op = new oc.BRepAlgoAPI_Cut_1();
  op.SetArguments(argsList);
  op.SetTools(toolsList);
  try {
    op.SetRunParallel(true);
  } catch {
    // Older bindings may not expose this — safe to ignore.
  }
  op.Build();
  return op.Shape();
}

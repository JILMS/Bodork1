import type { OC, ShapeHandle } from "./types";
import { makeCylinder } from "./geom-utils";

// Builds a hollow round tube (outer_diameter × wall_thickness × length)
// perforated with a HEXAGONAL / staggered pattern of round holes,
// like the perforated stainless-steel filter tubes used in mufflers
// and dust collectors. All perforations are subtracted in a SINGLE
// boolean cut against a TopoDS_Compound of tools — critical for
// performance when the pattern has 1000+ holes; the iterative
// per-hole Cut we use elsewhere would take 20+ minutes.
export function buildPerforatedTube(
  oc: OC,
  args: {
    outer_diameter_mm: number;
    wall_thickness_mm: number;
    length_mm: number;
    hole_diameter_mm: number;
    // Distance between hole EDGES (typical shop convention). Pitch
    // center-to-center = hole_diameter_mm + edge_gap_mm.
    edge_gap_mm: number;
    // How much of each end to leave un-perforated (10-15 mm is
    // typical to give the CAM a place to hold the tube).
    end_margin_mm: number;
  },
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

  // Hollow tube along X axis: outer − inner cylinder.
  const outer = makeCylinder(oc, [0, 0, 0], [1, 0, 0], rOuter, length);
  const inner = makeCylinder(oc, [0, 0, 0], [1, 0, 0], rInner, length);
  const tube = cutSingle(oc, outer, inner);

  // Pitch center-to-center along the circumference.
  const pitch = holeD + gap;
  const circumference = Math.PI * D;
  // Snap to a whole number of holes around the tube so the pattern
  // closes cleanly (no seam gap).
  const nCirc = Math.max(1, Math.round(circumference / pitch));
  const arcPitchRad = (2 * Math.PI) / nCirc;
  // Row spacing along the axis: pitch × √3/2 for hex close-pack.
  const rowSpacing = pitch * (Math.sqrt(3) / 2);

  // First and last hole centres sit at least end_margin from the
  // corresponding tube end, plus half a hole so the edge of the
  // hole clears the margin.
  const firstRowX = margin + holeR;
  const lastRowX = length - margin - holeR;
  const usableLen = lastRowX - firstRowX;
  const nRows = Math.max(0, Math.floor(usableLen / rowSpacing) + 1);

  // Build all hole tools; alternate rows are offset by half the
  // circumferential pitch (hexagonal staggering).
  const overshoot = wall * 0.6 + 1;
  const drillLen = D + overshoot * 2;
  const tools: ShapeHandle[] = [];
  for (let r = 0; r < nRows; r++) {
    const x = firstRowX + r * rowSpacing;
    const rowOffset = r % 2 === 0 ? 0 : arcPitchRad / 2;
    for (let c = 0; c < nCirc; c++) {
      const theta = c * arcPitchRad + rowOffset;
      const ny = Math.cos(theta);
      const nz = Math.sin(theta);
      // Origin just outside the outer surface; drill inwards.
      const origin: [number, number, number] = [
        x,
        ny * (rOuter + overshoot),
        nz * (rOuter + overshoot),
      ];
      const axis: [number, number, number] = [0, -ny, -nz];
      tools.push(makeCylinder(oc, origin, axis, holeR, drillLen));
    }
  }

  // ONE boolean cut against a compound of all drill tools. This is
  // orders of magnitude faster than iterating BRepAlgoAPI_Cut.
  const compound = buildCompound(oc, tools);
  const perforated = cutSingle(oc, tube, compound);

  return { shape: perforated, hole_count: tools.length };
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

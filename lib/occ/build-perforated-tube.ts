import type { OC, ShapeHandle } from "./types";

// Callback fired from inside the builder so the worker can forward a
// "batch_progress" event. The flat-sheet builder finishes in ~200 ms
// even for 1500+ holes, so we only emit start / end.
export type PerforatedProgress = (done: number, total: number) => void;

export type PerforatedTubeArgs = {
  outer_diameter_mm: number;
  wall_thickness_mm: number;
  length_mm: number;
  hole_diameter_mm: number;
  edge_gap_mm: number;
  end_margin_mm: number;
};

// Builds the FLAT (unrolled / developed) perforated blank that the
// Bodor K1 fibre laser actually cuts — a rectangle of size
// (length × π·D) × wall thickness with the hex hole pattern already
// in it. The operator cuts the flat pattern on the K1, then rolls it
// into a tube and welds the seam.
//
// Why not a round 3D tube? OCC's boolean cut (BRepAlgoAPI_Cut) is
// roughly O(N * body_faces) per cut, and body face count grows with
// every hole. Trying to subtract 1500 drill cylinders from a hollow
// tube took over an hour and eventually thrashed the browser. The
// flat blank is what the K1 needs anyway, and it's built from
// primitive planar faces so there is zero boolean work — just a
// single MakeFace with 1500 hole wires and one prism extrusion.
// Whole thing runs in ~200 ms.
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

  const holeR = holeD / 2;
  const pitch = holeD + gap;

  // Sheet dimensions: length × unrolled circumference.
  const sheetWidth = Math.PI * D;
  const nCirc = Math.max(1, Math.round(sheetWidth / pitch));
  const uPitch = sheetWidth / nCirc;
  const rowSpacing = pitch * (Math.sqrt(3) / 2);

  const firstRowX = margin + holeR;
  const lastRowX = length - margin - holeR;
  const usableLen = lastRowX - firstRowX;
  const nRows = Math.max(0, Math.floor(usableLen / rowSpacing) + 1);

  const totalHoles = nRows * nCirc;
  onProgress?.(0, totalHoles);

  const pnt = (x: number, y: number, z: number) => new oc.gp_Pnt_3(x, y, z);
  const dir = (x: number, y: number, z: number) => new oc.gp_Dir_4(x, y, z);
  const ax2 = (o: ShapeHandle, d: ShapeHandle) => new oc.gp_Ax2_3(o, d);

  // Rectangular outer wire in the Z=0 plane: (0,0) → (length, 0) →
  // (length, sheetWidth) → (0, sheetWidth) → close.
  const p1 = pnt(0, 0, 0);
  const p2 = pnt(length, 0, 0);
  const p3 = pnt(length, sheetWidth, 0);
  const p4 = pnt(0, sheetWidth, 0);
  const e1 = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2).Edge();
  const e2 = new oc.BRepBuilderAPI_MakeEdge_3(p2, p3).Edge();
  const e3 = new oc.BRepBuilderAPI_MakeEdge_3(p3, p4).Edge();
  const e4 = new oc.BRepBuilderAPI_MakeEdge_3(p4, p1).Edge();
  const outerWire = new oc.BRepBuilderAPI_MakeWire_5(e1, e2, e3, e4).Wire();

  const plane = new oc.gp_Pln_3(pnt(0, 0, 0), dir(0, 0, 1));
  const mkFace = new oc.BRepBuilderAPI_MakeFace_16(plane, outerWire, true);

  // N hole wires — planar circles reversed so OCC treats them as
  // inner boundaries (holes) rather than the outer boundary.
  for (let r = 0; r < nRows; r++) {
    const x = firstRowX + r * rowSpacing;
    const rowOffset = r % 2 === 0 ? 0 : uPitch / 2;
    for (let c = 0; c < nCirc; c++) {
      const u = c * uPitch + rowOffset;
      const gpCirc = new oc.gp_Circ_2(ax2(pnt(x, u, 0), dir(0, 0, 1)), holeR);
      const edge = new oc.BRepBuilderAPI_MakeEdge_8(gpCirc).Edge();
      const wire = new oc.BRepBuilderAPI_MakeWire_2(edge).Wire();
      mkFace.Add(oc.TopoDS.Wire_1(wire.Reversed()));
    }
  }

  const face = mkFace.Face();

  // Extrude by wall thickness in +Z → solid slab.
  const vec = new oc.gp_Vec_4(0, 0, wall);
  const solid = new oc.BRepPrimAPI_MakePrism_1(face, vec, false, true).Shape();

  onProgress?.(totalHoles, totalHoles);
  return { shape: solid, hole_count: totalHoles };
}

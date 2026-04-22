import type { FlatBar, Hole } from "../part-spec";
import type { OC, ShapeHandle } from "./types";
import { cutMany, makeBox, makeCylinder } from "./geom-utils";

// Builds a flat bar along the X axis:
//   X = length (0 .. length_mm)
//   Y = width  (0 .. width_mm)
//   Z = thickness (0 .. thickness_mm)
//
// Holes are drilled through the thickness (Z axis). position_mm is along X,
// edge_offset_mm is measured from Y=0 (defaults to the centerline).
// Countersunk holes are modeled as a cylinder + a cone on top so the
// exported STEP reflects the real cut geometry the laser will make.
export function buildFlatBar(oc: OC, spec: FlatBar): ShapeHandle {
  const { length_mm, width_mm, thickness_mm, holes } = spec;

  const body = makeBox(oc, length_mm, width_mm, thickness_mm);
  const overshoot = 0.1; // make the drill slightly longer to guarantee a clean cut
  const tools: ShapeHandle[] = holes.map((h) =>
    holeTool(oc, h, width_mm, thickness_mm, overshoot),
  );
  return cutMany(oc, body, tools);
}

function holeTool(
  oc: OC,
  h: Hole,
  width: number,
  thickness: number,
  overshoot: number,
): ShapeHandle {
  const x = h.position_mm;
  const y = h.edge_offset_mm ?? width / 2;
  const r = h.diameter_mm / 2;
  const height = thickness + overshoot * 2;

  if (h.type === "countersunk") {
    // Simple approximation: a through hole of r_min (0.6 * r) with a
    // 90-degree conical chamfer on top that widens to diameter_mm.
    const rMin = Math.max(r * 0.6, r - thickness * 0.5);
    const cyl = makeCylinder(
      oc,
      [x, y, -overshoot],
      [0, 0, 1],
      rMin,
      height,
    );
    const coneHeight = Math.min(thickness * 0.5, r - rMin);
    const cone = makeCone(
      oc,
      [x, y, thickness - coneHeight],
      [0, 0, 1],
      rMin,
      r,
      coneHeight + overshoot,
    );
    return fuse(oc, cyl, cone);
  }

  return makeCylinder(oc, [x, y, -overshoot], [0, 0, 1], r, height);
}

function makeCone(
  oc: OC,
  origin: [number, number, number],
  axis: [number, number, number],
  rBottom: number,
  rTop: number,
  height: number,
): ShapeHandle {
  const pnt = new oc.gp_Pnt_3(origin[0], origin[1], origin[2]);
  const dir = new oc.gp_Dir_4(axis[0], axis[1], axis[2]);
  const ax2 = new oc.gp_Ax2_3(pnt, dir);
  return new oc.BRepPrimAPI_MakeCone_3(ax2, rBottom, rTop, height).Shape();
}

function fuse(oc: OC, a: ShapeHandle, b: ShapeHandle): ShapeHandle {
  const op = new oc.BRepAlgoAPI_Fuse_3(a, b, new oc.Message_ProgressRange_1());
  op.Build(new oc.Message_ProgressRange_1());
  return op.Shape();
}

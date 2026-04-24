import type { SquareTube } from "../part-spec";
import type { OC, ShapeHandle } from "./types";
import { cut, cutMany, makeCylinder } from "./geom-utils";
import { buildRoundedRectTube } from "./tube-utils";

// Builds a hollow square tube along the X axis, side_mm × side_mm cross
// section, length_mm long, wall of wall_thickness_mm. Faces are numbered:
//   1 = top    (+Z)
//   2 = right  (+Y)
//   3 = bottom (-Z)
//   4 = left   (-Y)
//
// If corner_radius_mm > 0, the outer corners are filleted (real-world
// square tubes always have some corner radius ~1-2× wall thickness).
export function buildSquareTube(oc: OC, spec: SquareTube): ShapeHandle {
  const { length_mm, side_mm, wall_thickness_mm, holes } = spec;
  const rCorner = spec.corner_radius_mm ?? 0;

  let body = buildRoundedRectTube(
    oc,
    length_mm,
    side_mm,
    side_mm,
    wall_thickness_mm,
    rCorner,
  );

  const half = side_mm / 2;
  const overshoot = wall_thickness_mm + 1;
  const tools: ShapeHandle[] = holes.map((h) => {
    const r = h.diameter_mm / 2;
    const drillLen = side_mm + overshoot * 2;
    const x = h.position_mm;
    switch (h.face) {
      case 1:
        return makeCylinder(oc, [x, 0, half + overshoot], [0, 0, -1], r, drillLen);
      case 2:
        return makeCylinder(oc, [x, half + overshoot, 0], [0, -1, 0], r, drillLen);
      case 3:
        return makeCylinder(oc, [x, 0, -half - overshoot], [0, 0, 1], r, drillLen);
      case 4:
        return makeCylinder(oc, [x, -half - overshoot, 0], [0, 1, 0], r, drillLen);
    }
  });

  body = cutMany(oc, body, tools);
  // Silence unused-import lint for `cut` in the no-holes path.
  if (tools.length === 0) void cut;
  return body;
}

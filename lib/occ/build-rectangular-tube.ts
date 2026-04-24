import type { RectangularTube } from "../part-spec";
import type { OC, ShapeHandle } from "./types";
import { cutMany, makeCylinder } from "./geom-utils";
import { buildRoundedRectTube } from "./tube-utils";

// Hollow rectangular tube along the X axis. The cross-section is
// width_mm (Y) × height_mm (Z). Faces (for hole placement):
//   1 = top    (+Z)
//   2 = right  (+Y)
//   3 = bottom (-Z)
//   4 = left   (-Y)
// corner_radius_mm rounds the four outer vertical edges.
export function buildRectangularTube(
  oc: OC,
  spec: RectangularTube,
): ShapeHandle {
  const { length_mm, width_mm, height_mm, wall_thickness_mm, holes } = spec;
  const rCorner = spec.corner_radius_mm ?? 0;

  let body = buildRoundedRectTube(
    oc,
    length_mm,
    width_mm,
    height_mm,
    wall_thickness_mm,
    rCorner,
  );

  const halfY = width_mm / 2;
  const halfZ = height_mm / 2;
  const overshoot = wall_thickness_mm + 1;
  const tools: ShapeHandle[] = holes.map((h) => {
    const r = h.diameter_mm / 2;
    const x = h.position_mm;
    switch (h.face) {
      case 1: {
        const drillLen = height_mm + overshoot * 2;
        return makeCylinder(oc, [x, 0, halfZ + overshoot], [0, 0, -1], r, drillLen);
      }
      case 2: {
        const drillLen = width_mm + overshoot * 2;
        return makeCylinder(oc, [x, halfY + overshoot, 0], [0, -1, 0], r, drillLen);
      }
      case 3: {
        const drillLen = height_mm + overshoot * 2;
        return makeCylinder(oc, [x, 0, -halfZ - overshoot], [0, 0, 1], r, drillLen);
      }
      case 4: {
        const drillLen = width_mm + overshoot * 2;
        return makeCylinder(oc, [x, -halfY - overshoot, 0], [0, 1, 0], r, drillLen);
      }
    }
  });

  body = cutMany(oc, body, tools);
  return body;
}

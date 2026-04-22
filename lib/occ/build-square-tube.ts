import type { SquareTube } from "../part-spec";
import type { OC, ShapeHandle } from "./types";
import { cut, cutMany, makeBox, makeCylinder } from "./geom-utils";

// Builds a hollow square tube along the X axis, side_mm x side_mm cross
// section, length_mm long, wall of wall_thickness_mm. Faces are numbered:
//   1 = top    (+Z)
//   2 = right  (+Y)
//   3 = bottom (-Z)
//   4 = left   (-Y)
export function buildSquareTube(oc: OC, spec: SquareTube): ShapeHandle {
  const { length_mm, side_mm, wall_thickness_mm, holes } = spec;
  const half = side_mm / 2;
  const wall = wall_thickness_mm;
  const innerHalf = Math.max(half - wall, 0.01);

  // Outer box centered on the X axis: (-half..half) in Y and Z.
  const outer = makeBox(oc, length_mm, side_mm, side_mm);
  const outerMoved = translateTo(oc, outer, 0, -half, -half);
  const inner = makeBox(oc, length_mm, innerHalf * 2, innerHalf * 2);
  const innerMoved = translateTo(oc, inner, 0, -innerHalf, -innerHalf);
  let body = cut(oc, outerMoved, innerMoved);

  const overshoot = wall + 1;
  const tools: ShapeHandle[] = holes.map((h) => {
    const r = h.diameter_mm / 2;
    const drillLen = side_mm + overshoot * 2;
    const x = h.position_mm;
    switch (h.face) {
      case 1: // top
        return makeCylinder(
          oc,
          [x, 0, half + overshoot],
          [0, 0, -1],
          r,
          drillLen,
        );
      case 2: // right
        return makeCylinder(
          oc,
          [x, half + overshoot, 0],
          [0, -1, 0],
          r,
          drillLen,
        );
      case 3: // bottom
        return makeCylinder(
          oc,
          [x, 0, -half - overshoot],
          [0, 0, 1],
          r,
          drillLen,
        );
      case 4: // left
        return makeCylinder(
          oc,
          [x, -half - overshoot, 0],
          [0, 1, 0],
          r,
          drillLen,
        );
    }
  });

  body = cutMany(oc, body, tools);
  return body;
}

function translateTo(
  oc: OC,
  shape: ShapeHandle,
  dx: number,
  dy: number,
  dz: number,
): ShapeHandle {
  const trsf = new oc.gp_Trsf_1();
  trsf.SetTranslation_1(new oc.gp_Vec_4(dx, dy, dz));
  const loc = new oc.TopLoc_Location_2(trsf);
  return shape.Moved(loc, false);
}

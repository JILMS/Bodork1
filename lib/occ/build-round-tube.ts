import type { RoundTube } from "../part-spec";
import type { OC, ShapeHandle } from "./types";
import { cut, cutMany, makeCylinder } from "./geom-utils";

// Builds a round tube along the X axis. Holes are drilled radially from
// the outer surface through the wall, at a given face_angle_deg around
// the tube axis and position_mm along the length.
export function buildRoundTube(oc: OC, spec: RoundTube): ShapeHandle {
  const { length_mm, outer_diameter_mm, wall_thickness_mm, holes } = spec;
  const rOuter = outer_diameter_mm / 2;
  const rInner = Math.max(rOuter - wall_thickness_mm, 0.01);

  const outer = makeCylinder(oc, [0, 0, 0], [1, 0, 0], rOuter, length_mm);
  const inner = makeCylinder(oc, [0, 0, 0], [1, 0, 0], rInner, length_mm);
  let body = cut(oc, outer, inner);

  const overshoot = rOuter * 0.2 + 1;
  const tools: ShapeHandle[] = holes.map((h) => {
    const angleRad = ((h.face_angle_deg ?? 0) * Math.PI) / 180;
    const x = h.position_mm;
    // Hole axis is radial; origin is just outside the outer surface.
    const ny = Math.cos(angleRad);
    const nz = Math.sin(angleRad);
    const origin: [number, number, number] = [
      x,
      ny * (rOuter + overshoot),
      nz * (rOuter + overshoot),
    ];
    const axis: [number, number, number] = [0, -ny, -nz];
    const r = h.diameter_mm / 2;
    const drillLen = outer_diameter_mm + overshoot * 2;
    return makeCylinder(oc, origin, axis, r, drillLen);
  });

  body = cutMany(oc, body, tools);
  return body;
}

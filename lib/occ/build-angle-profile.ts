import type { AngleProfile, Hole } from "../part-spec";
import type { OC, ShapeHandle } from "./types";
import {
  cutMany,
  makeBox,
  makeCylinder,
} from "./geom-utils";

// Builds an L-shaped (angle) profile along the X axis.
//
// Coordinate convention (matches the rest of the codebase: X = length,
// machine starts cutting from X=0, the LEFT end of the bar):
//   X: length         (0 .. length_mm)
//   Y: leg A (flat, horizontal)
//   Z: leg B (upright, vertical)
// The inside corner of the L sits at Y=0, Z=0.
//
// Cross-section is the union of two slabs that share the t × t corner:
//   - leg A slab: Y in [0, leg_a],  Z in [0, thickness]
//   - leg B slab: Y in [0, thickness], Z in [0, leg_b]
//
// Holes:
//   - leg "a": drilled through the horizontal slab from above. The
//     drill axis is along Z. position_mm is the X coordinate of the
//     hole center. edge_offset_mm is measured from the OUTSIDE edge of
//     leg A (Y = leg_a) toward the corner. Default: centered on the
//     overhanging part of the slab, i.e. y = thickness + (leg_a -
//     thickness) / 2.
//   - leg "b": drilled through the vertical slab from outside. Drill
//     axis along Y. edge_offset_mm is measured from the top edge
//     (Z = leg_b) downward. Default: centered the same way on the
//     overhanging part of leg B.
export function buildAngleProfile(
  oc: OC,
  spec: AngleProfile,
): ShapeHandle {
  const { length_mm, leg_a_mm, leg_b_mm, thickness_mm, holes } = spec;
  const t = thickness_mm;

  // Slab A (horizontal): box positioned at Y=0..leg_a, Z=0..t.
  let slabA = makeBox(oc, length_mm, leg_a_mm, t);
  // makeBox starts at origin already, so no translation needed for slabA.

  // Slab B (vertical): box of size length × t × leg_b at Y=0..t, Z=0..leg_b.
  let slabB = makeBox(oc, length_mm, t, leg_b_mm);

  // Fuse them. They overlap in the t × t corner so the result is a
  // proper L cross-section.
  const fused = fuse(oc, slabA, slabB);

  const overshoot = t + 1;
  const tools: ShapeHandle[] = holes.map((h) =>
    holeTool(oc, h, leg_a_mm, leg_b_mm, t, overshoot),
  );

  // Silence unused-import lint when there are no holes.
  void slabA;
  void slabB;

  if (tools.length === 0) return fused;
  return cutMany(oc, fused, tools);
}

function holeTool(
  oc: OC,
  h: Hole & { leg: "a" | "b" },
  legA: number,
  legB: number,
  thickness: number,
  overshoot: number,
): ShapeHandle {
  const r = h.diameter_mm / 2;
  const x = h.position_mm;

  if (h.leg === "a") {
    // Default: centered on the overhanging part of leg A so the hole
    // doesn't punch into the corner stack.
    const overhang = Math.max(legA - thickness, 0);
    const y =
      h.edge_offset_mm !== undefined
        ? legA - h.edge_offset_mm
        : thickness + overhang / 2;
    const drillLen = thickness + overshoot * 2;
    return makeCylinder(
      oc,
      [x, y, thickness + overshoot],
      [0, 0, -1],
      r,
      drillLen,
    );
  }

  // leg "b": drill along -Y from outside the vertical slab.
  const overhang = Math.max(legB - thickness, 0);
  const z =
    h.edge_offset_mm !== undefined
      ? legB - h.edge_offset_mm
      : thickness + overhang / 2;
  const drillLen = thickness + overshoot * 2;
  return makeCylinder(
    oc,
    [x, thickness + overshoot, z],
    [0, -1, 0],
    r,
    drillLen,
  );
}

function fuse(oc: OC, a: ShapeHandle, b: ShapeHandle): ShapeHandle {
  const op = new oc.BRepAlgoAPI_Fuse_3(a, b);
  op.Build();
  return op.Shape();
}

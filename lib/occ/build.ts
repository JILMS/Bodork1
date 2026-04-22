import type { PartSpec } from "../part-spec";
import type { OC, ShapeHandle } from "./types";
import { buildFlatBar } from "./build-flat-bar";
import { buildRoundTube } from "./build-round-tube";
import { buildSquareTube } from "./build-square-tube";
import { buildAngleProfile } from "./build-angle-profile";
import { isSolidValid } from "./geom-utils";

export type BuildResult = {
  shape: ShapeHandle;
  watertight: boolean;
};

// Dispatches on profile kind and validates the resulting solid.
// We don't throw on non-watertight — we surface it so the UI can warn.
export function buildPart(oc: OC, spec: PartSpec): BuildResult {
  let shape: ShapeHandle;
  switch (spec.profile.kind) {
    case "flat_bar":
      shape = buildFlatBar(oc, spec.profile);
      break;
    case "round_tube":
      shape = buildRoundTube(oc, spec.profile);
      break;
    case "square_tube":
      shape = buildSquareTube(oc, spec.profile);
      break;
    case "angle_profile":
      shape = buildAngleProfile(oc, spec.profile);
      break;
  }
  return { shape, watertight: isSolidValid(oc, shape) };
}

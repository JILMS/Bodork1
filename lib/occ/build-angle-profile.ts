import type { AngleProfile } from "../part-spec";
import type { OC, ShapeHandle } from "./types";

// TODO v1.1: angle/L-profile geometry (sweep L section along X axis,
// drill per-leg holes, handle miter cuts at ends). For v1 we reject the
// request at validation time rather than emit an invalid STEP.
export function buildAngleProfile(_oc: OC, _spec: AngleProfile): ShapeHandle {
  throw new Error(
    "Perfil en L todavía no está implementado en v1. Llegará en v1.1.",
  );
}

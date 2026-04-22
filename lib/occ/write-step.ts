import type { OC, ShapeHandle } from "./types";

// Writes an OCC shape to a STEP AP214 string. Units are explicitly set to
// millimetres so the Bodor postprocessor interprets dimensions correctly.
export function writeStep(oc: OC, shape: ShapeHandle, filename = "part.step"): string {
  // Force millimetre output.
  oc.Interface_Static.SetCVal("xstep.cascade.unit", "MM");
  oc.Interface_Static.SetCVal("write.step.unit", "MM");
  oc.Interface_Static.SetIVal("write.step.schema", 3); // AP214

  const writer = new oc.STEPControl_Writer_1();
  const status = writer.Transfer(
    shape,
    oc.STEPControl_StepModelType.STEPControl_AsIs,
    true,
    new oc.Message_ProgressRange_1(),
  );
  if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
    throw new Error("OpenCascade STEPControl_Writer.Transfer falló.");
  }

  // Write to the Emscripten virtual FS and read back.
  writer.Write(filename);
  const data: Uint8Array = oc.FS.readFile(`/${filename}`);
  return new TextDecoder().decode(data);
}

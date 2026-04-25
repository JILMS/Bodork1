import type { OC, ShapeHandle } from "./types";

// Writes a shape as a binary STL mesh. STL only carries triangles, so we
// first run BRepMesh_IncrementalMesh to tessellate the solid.
export function writeStl(oc: OC, shape: ShapeHandle): Uint8Array {
  new oc.BRepMesh_IncrementalMesh_2(shape, 0.5, false, 0.5, false);
  const writer = new oc.StlAPI_Writer();
  writer.ASCIIMode = false; // binary STL is ~5× smaller
  const filename = "/part.stl";
  writer.Write(shape, filename, new oc.Message_ProgressRange_1());
  const data: Uint8Array = oc.FS.readFile(filename);
  return data;
}

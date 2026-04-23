import type { OC, ShapeHandle } from "./types";

// Creates a cylinder aligned along a given axis at a given origin, with
// radius r and height h. Used to build drills that are later subtracted
// from a part.
export function makeCylinder(
  oc: OC,
  origin: [number, number, number],
  axis: [number, number, number],
  radius: number,
  height: number,
): ShapeHandle {
  const pnt = new oc.gp_Pnt_3(origin[0], origin[1], origin[2]);
  const dir = new oc.gp_Dir_4(axis[0], axis[1], axis[2]);
  const ax2 = new oc.gp_Ax2_3(pnt, dir);
  return new oc.BRepPrimAPI_MakeCylinder_3(ax2, radius, height).Shape();
}

// Subtracts `tool` from `base` (boolean cut). Returns the resulting shape.
// The _3 suffix is opencascade.js's overload index (1 + arity), so
// `Cut_3(shape, shape)` is the 2-arg constructor in OCCT.
export function cut(oc: OC, base: ShapeHandle, tool: ShapeHandle): ShapeHandle {
  const op = new oc.BRepAlgoAPI_Cut_3(base, tool);
  op.Build();
  return op.Shape();
}

// Iteratively subtracts multiple tools from a base.
export function cutMany(
  oc: OC,
  base: ShapeHandle,
  tools: ShapeHandle[],
): ShapeHandle {
  let result = base;
  for (const t of tools) {
    result = cut(oc, result, t);
  }
  return result;
}

// Translates a shape by (dx, dy, dz).
export function translate(
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

// Builds a solid box from (0,0,0) to (dx, dy, dz).
export function makeBox(
  oc: OC,
  dx: number,
  dy: number,
  dz: number,
): ShapeHandle {
  return new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz).Shape();
}

// Returns true if the shape passes OpenCascade's B-Rep validity checks,
// which is a proxy for "watertight solid" good enough for STEP export.
export function isSolidValid(oc: OC, shape: ShapeHandle): boolean {
  const analyzer = new oc.BRepCheck_Analyzer(shape, true);
  return analyzer.IsValid_2();
}

// Volume of a solid (for unit tests).
export function volumeOf(oc: OC, shape: ShapeHandle): number {
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
  return props.Mass();
}

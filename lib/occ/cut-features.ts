import type { OC, ShapeHandle } from "./types";
import { cutMany, makeBox, makeCylinder } from "./geom-utils";

// Geometry parameters for placing a slot/rect tool that perforates a
// flat face. The face is parameterised by:
//   center: world coordinates of the cut center on the OUTER side of
//     the face (the cut starts from there and goes inward).
//   normal: unit vector pointing INTO the part (cut direction).
//   uAxis:  unit vector along the local "length" axis on the face.
//   vAxis:  unit vector along the local "width" axis on the face.
//   length / width / depth: tool dimensions.
type FaceFrame = {
  center: [number, number, number];
  normal: [number, number, number];
  uAxis: [number, number, number];
  vAxis: [number, number, number];
};

function placeAlong(
  origin: [number, number, number],
  axis: [number, number, number],
  d: number,
): [number, number, number] {
  return [origin[0] + axis[0] * d, origin[1] + axis[1] * d, origin[2] + axis[2] * d];
}

function rotateInPlane(
  uAxis: [number, number, number],
  vAxis: [number, number, number],
  rotation_deg: number,
): { u: [number, number, number]; v: [number, number, number] } {
  const r = (rotation_deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const u: [number, number, number] = [
    uAxis[0] * c + vAxis[0] * s,
    uAxis[1] * c + vAxis[1] * s,
    uAxis[2] * c + vAxis[2] * s,
  ];
  const v: [number, number, number] = [
    -uAxis[0] * s + vAxis[0] * c,
    -uAxis[1] * s + vAxis[1] * c,
    -uAxis[2] * s + vAxis[2] * c,
  ];
  return { u, v };
}

function cross(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

// Build an oriented box tool centered at origin, sizes length × width
// × depth along (u, v, normal). We construct an axis-aligned box and
// move it with a generic transform.
function makeOrientedBox(
  oc: OC,
  origin: [number, number, number],
  u: [number, number, number],
  v: [number, number, number],
  n: [number, number, number],
  length: number,
  width: number,
  depth: number,
): ShapeHandle {
  // Place a unit-axis box, then build a transform matrix that maps
  // local axes to (u, v, n).
  const box = makeBox(oc, length, width, depth); // span along world X, Y, Z

  // local origin is at (0,0,0), the box spans [0..length, 0..width, 0..depth]
  // Center of the box bottom face (at depth=0) is at (length/2, width/2, 0).
  // We want the cut to start at `origin` (a face center) going along n,
  // with u/v as the tangent axes.
  // Translate the box so its (length/2, width/2, 0) lands at origin.
  // Then rotate so X→u, Y→v, Z→n.

  // Use gp_Trsf.SetValues to set a 3×4 affine matrix.
  const trsf = new oc.gp_Trsf_1();
  // SetValues_1(a11,a12,a13,a14, a21,a22,a23,a24, a31,a32,a33,a34)
  // The columns of the rotation matrix are u, v, n.
  // To position correctly, the translation column places the box's
  // (length/2, width/2, 0) at `origin`:
  //   T(p) = R·p + t  where R columns = u,v,n.
  //   t = origin - R·(length/2, width/2, 0) = origin - (u·length/2 + v·width/2)
  const tx =
    origin[0] - u[0] * (length / 2) - v[0] * (width / 2);
  const ty =
    origin[1] - u[1] * (length / 2) - v[1] * (width / 2);
  const tz =
    origin[2] - u[2] * (length / 2) - v[2] * (width / 2);

  trsf.SetValues(
    u[0], v[0], n[0], tx,
    u[1], v[1], n[1], ty,
    u[2], v[2], n[2], tz,
  );
  const loc = new oc.TopLoc_Location_2(trsf);
  return box.Moved(loc);
}

// Build a "stadium" tool — rectangle + 2 half-circles on the short
// ends. Implemented as a fused box + 2 cylinders, all aligned with the
// (u, v, normal) frame at the slot center.
//
// `length_mm` is the long-axis extent (along u). `width_mm` is the
// short-axis (along v). `depth` is along normal.
export function makeSlotTool(
  oc: OC,
  frame: FaceFrame,
  length: number,
  width: number,
  depth: number,
  rotation_deg: number,
): ShapeHandle {
  const { u, v } = rotateInPlane(frame.uAxis, frame.vAxis, rotation_deg);
  const n = frame.normal;

  // Central rectangle: spans (length - width) along u, width along v,
  // depth along n. Its center is the slot center.
  const innerLen = Math.max(length - width, 0.01);
  const rect = makeOrientedBox(
    oc,
    frame.center,
    u,
    v,
    n,
    innerLen,
    width,
    depth,
  );

  // End caps: two cylinders of radius=width/2 at ±(length-width)/2
  // along u from center, axis along n.
  const halfStep = innerLen / 2;
  const r = width / 2;
  const cap1Origin = placeAlong(frame.center, u, halfStep);
  const cap2Origin = placeAlong(frame.center, u, -halfStep);
  const cap1 = makeCylinder(oc, cap1Origin, n, r, depth);
  const cap2 = makeCylinder(oc, cap2Origin, n, r, depth);

  // Fuse the three together so the boolean cut is a single op.
  const f1 = fuse(oc, rect, cap1);
  return fuse(oc, f1, cap2);
}

// Sharp-cornered rectangular cutout tool. Same parameters as a slot
// but no rounded ends.
export function makeRectTool(
  oc: OC,
  frame: FaceFrame,
  length: number,
  width: number,
  depth: number,
  rotation_deg: number,
): ShapeHandle {
  const { u, v } = rotateInPlane(frame.uAxis, frame.vAxis, rotation_deg);
  return makeOrientedBox(oc, frame.center, u, v, frame.normal, length, width, depth);
}

function fuse(oc: OC, a: ShapeHandle, b: ShapeHandle): ShapeHandle {
  const op = new oc.BRepAlgoAPI_Fuse_3(a, b);
  op.Build();
  return op.Shape();
}

// Convenience: subtract a list of feature tools from the body.
export function applyFeatures(
  oc: OC,
  body: ShapeHandle,
  tools: ShapeHandle[],
): ShapeHandle {
  if (tools.length === 0) return body;
  return cutMany(oc, body, tools);
}

// Helpers used by per-profile builders:

// FlatBar / leg-A face frame: face is the X-Y plane at Z = thickness,
// with normal pointing -Z (into the part). u along X (length), v along
// Y (width). center is at (position_mm, edge_offset_mm, thickness).
export function flatFaceFrame(
  position_mm: number,
  edge_offset_mm: number,
  thickness: number,
  overshoot: number,
): FaceFrame {
  return {
    center: [position_mm, edge_offset_mm, thickness + overshoot],
    normal: [0, 0, -1],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
  };
}

// Angle profile leg-B (vertical wall): face is the X-Z plane at Y =
// thickness, normal -Y, u along X, v along Z.
export function legBFaceFrame(
  position_mm: number,
  edge_offset_mm_from_top: number,
  legB_total: number,
  thickness: number,
  overshoot: number,
): FaceFrame {
  // edge_offset_mm in the angle leg-b convention is from the TOP edge
  // (Z = legB_total) toward the corner. So actual Z coordinate is:
  const z = legB_total - edge_offset_mm_from_top;
  return {
    center: [position_mm, thickness + overshoot, z],
    normal: [0, -1, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
  };
}

// Suppress unused-export lint while still exporting cross for any
// future use (e.g. arbitrary face frames on tubes).
void cross;

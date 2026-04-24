import type { OC, ShapeHandle } from "./types";
import { cut, makeBox } from "./geom-utils";

// Builds a hollow rectangular tube along the X axis. The outer cross-
// section is width × height (Y × Z), centered on the X axis. wall is
// the wall thickness and corner is the corner radius (0 = sharp).
//
// Implementation:
// - Make outer box, translate so it's centered, apply fillet to the 4
//   vertical (X-aligned) edges if corner > 0.
// - Same for inner box, but with max(corner - wall, 0) radius.
// - Boolean subtract the inner from the outer.
//
// OCC's BRepFilletAPI_MakeFillet takes a shape + edges; we iterate
// edges via TopExp_Explorer and pick the X-aligned ones by looking at
// their endpoint delta.
export function buildRoundedRectTube(
  oc: OC,
  length: number,
  width: number,
  height: number,
  wall: number,
  cornerRadius: number,
): ShapeHandle {
  const innerW = Math.max(width - 2 * wall, 0.02);
  const innerH = Math.max(height - 2 * wall, 0.02);

  let outer = makeBox(oc, length, width, height);
  outer = translate(oc, outer, 0, -width / 2, -height / 2);
  let inner = makeBox(oc, length, innerW, innerH);
  inner = translate(oc, inner, 0, -innerW / 2, -innerH / 2);

  if (cornerRadius > 0) {
    const outerR = Math.min(cornerRadius, width / 2 - 0.01, height / 2 - 0.01);
    outer = filletVerticalEdges(oc, outer, outerR);
    const innerR = Math.max(cornerRadius - wall, 0);
    if (innerR > 0.01) {
      const innerRSafe = Math.min(
        innerR,
        innerW / 2 - 0.01,
        innerH / 2 - 0.01,
      );
      inner = filletVerticalEdges(oc, inner, innerRSafe);
    }
  }

  return cut(oc, outer, inner);
}

function translate(
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

// Iterates edges of a box-like solid and applies a fillet of `radius`
// to the ones parallel to the X axis (the four vertical edges when the
// cross-section is in Y-Z).
function filletVerticalEdges(
  oc: OC,
  shape: ShapeHandle,
  radius: number,
): ShapeHandle {
  const mk = new oc.BRepFilletAPI_MakeFillet(shape);
  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  const seen = new Set<string>();
  let added = 0;
  while (explorer.More()) {
    const edge = oc.TopoDS.Edge_1(explorer.Current());
    if (isXAlignedEdge(oc, edge)) {
      // Avoid adding the same logical edge twice (each edge appears
      // once per adjacent face when iterating through all edges via
      // TopExp_Explorer on the full shape).
      const key = edgeKey(oc, edge);
      if (!seen.has(key)) {
        seen.add(key);
        mk.Add_2(radius, edge);
        added++;
      }
    }
    explorer.Next();
  }
  if (added === 0) return shape;
  return mk.Shape();
}

function isXAlignedEdge(oc: OC, edge: ShapeHandle): boolean {
  // Use BRep_Tool.Range to find param bounds, then Pnt at both ends.
  const curve = oc.BRep_Tool.Curve_2(edge, { current: 0 }, { current: 0 });
  // Easier path: sample two vertices of the edge.
  const explorer = new oc.TopExp_Explorer_2(
    edge,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  const points: Array<[number, number, number]> = [];
  while (explorer.More() && points.length < 2) {
    const vtx = oc.TopoDS.Vertex_1(explorer.Current());
    const pnt = oc.BRep_Tool.Pnt(vtx);
    points.push([pnt.X(), pnt.Y(), pnt.Z()]);
    explorer.Next();
  }
  // Silence lint on `curve` — kept so we don't accidentally regress if
  // we need curve parametrics later.
  void curve;
  if (points.length < 2) return false;
  const [a, b] = points;
  const dx = Math.abs(a[0] - b[0]);
  const dy = Math.abs(a[1] - b[1]);
  const dz = Math.abs(a[2] - b[2]);
  return dx > 0.5 && dy < 0.01 && dz < 0.01;
}

function edgeKey(oc: OC, edge: ShapeHandle): string {
  const explorer = new oc.TopExp_Explorer_2(
    edge,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  const pts: number[] = [];
  while (explorer.More()) {
    const vtx = oc.TopoDS.Vertex_1(explorer.Current());
    const pnt = oc.BRep_Tool.Pnt(vtx);
    pts.push(pnt.X(), pnt.Y(), pnt.Z());
    explorer.Next();
  }
  // Round to 3 dp to dedupe numerically.
  return pts
    .map((v) => Math.round(v * 1000) / 1000)
    .sort((a, b) => a - b)
    .join(",");
}

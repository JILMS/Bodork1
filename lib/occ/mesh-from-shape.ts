import type { OC, ShapeHandle } from "./types";

export type Mesh = {
  positions: Float32Array; // xyz per vertex
  normals: Float32Array; // xyz per vertex
  indices: Uint32Array;
};

// Tessellates an OCC shape into a triangle mesh suitable for three.js.
// Uses BRepMesh_IncrementalMesh and iterates the faces via TopExp_Explorer.
export function meshFromShape(oc: OC, shape: ShapeHandle): Mesh {
  // 0.2 mm linear deflection: small enough that 8-15 mm holes look
  // smooth (~32 facets per circle), big enough to keep mesh size sane
  // for 2 m bars. Angular deflection 0.5 rad keeps tubes acceptable.
  new oc.BRepMesh_IncrementalMesh_2(shape, 0.2, false, 0.5, false);

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  while (explorer.More()) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const location = new oc.TopLoc_Location_1();
    const triangulation = oc.BRep_Tool.Triangulation(face, location);
    if (triangulation.IsNull()) {
      explorer.Next();
      continue;
    }
    const tri = triangulation.get();
    const trsf = location.Transformation();
    const baseIndex = positions.length / 3;

    // Nodes
    const nbNodes = tri.NbNodes();
    for (let i = 1; i <= nbNodes; i++) {
      const pnt = tri.Node(i).Transformed(trsf);
      positions.push(pnt.X(), pnt.Y(), pnt.Z());
      normals.push(0, 0, 0); // filled below
    }

    // Triangles
    const nbTris = tri.NbTriangles();
    const reversed =
      face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    for (let i = 1; i <= nbTris; i++) {
      const t = tri.Triangle(i);
      const n1 = t.Value(1) - 1 + baseIndex;
      const n2 = t.Value(2) - 1 + baseIndex;
      const n3 = t.Value(3) - 1 + baseIndex;
      if (reversed) {
        indices.push(n1, n3, n2);
      } else {
        indices.push(n1, n2, n3);
      }
    }

    explorer.Next();
  }

  // Compute per-vertex normals from triangle normals.
  const positionsF = new Float32Array(positions);
  const normalsF = new Float32Array(normals.length);
  const indicesU = new Uint32Array(indices);

  for (let i = 0; i < indicesU.length; i += 3) {
    const a = indicesU[i] * 3;
    const b = indicesU[i + 1] * 3;
    const c = indicesU[i + 2] * 3;
    const abx = positionsF[b] - positionsF[a];
    const aby = positionsF[b + 1] - positionsF[a + 1];
    const abz = positionsF[b + 2] - positionsF[a + 2];
    const acx = positionsF[c] - positionsF[a];
    const acy = positionsF[c + 1] - positionsF[a + 1];
    const acz = positionsF[c + 2] - positionsF[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    normalsF[a] += nx;
    normalsF[a + 1] += ny;
    normalsF[a + 2] += nz;
    normalsF[b] += nx;
    normalsF[b + 1] += ny;
    normalsF[b + 2] += nz;
    normalsF[c] += nx;
    normalsF[c + 1] += ny;
    normalsF[c + 2] += nz;
  }
  // Normalize
  for (let i = 0; i < normalsF.length; i += 3) {
    const x = normalsF[i];
    const y = normalsF[i + 1];
    const z = normalsF[i + 2];
    const len = Math.hypot(x, y, z) || 1;
    normalsF[i] = x / len;
    normalsF[i + 1] = y / len;
    normalsF[i + 2] = z / len;
  }

  return { positions: positionsF, normals: normalsF, indices: indicesU };
}

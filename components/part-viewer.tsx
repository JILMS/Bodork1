"use client";
import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, GizmoHelper, GizmoViewport, Grid } from "@react-three/drei";
import * as THREE from "three";
import type { Mesh as PartMesh } from "@/lib/occ/mesh-from-shape";

function PartGeometry({ mesh }: { mesh: PartMesh }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    g.computeBoundingBox();
    return g;
  }, [mesh]);

  const center = useMemo(() => {
    const box = geometry.boundingBox ?? new THREE.Box3();
    const c = new THREE.Vector3();
    box.getCenter(c);
    return c;
  }, [geometry]);

  const size = useMemo(() => {
    const box = geometry.boundingBox ?? new THREE.Box3();
    const s = new THREE.Vector3();
    box.getSize(s);
    return Math.max(s.x, s.y, s.z);
  }, [geometry]);

  return (
    <group position={[-center.x, -center.y, -center.z]}>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color="#c0c8d0"
          metalness={0.8}
          roughness={0.35}
        />
      </mesh>
      <PartCameraFit size={size} />
    </group>
  );
}

function PartCameraFit({ size }: { size: number }) {
  // Keep a ref so OrbitControls can see a sensible initial distance.
  // Drei's OrbitControls handles the actual camera move via makeDefault.
  return (
    <mesh visible={false}>
      <sphereGeometry args={[size * 0.55, 4, 4]} />
      <meshBasicMaterial />
    </mesh>
  );
}

type Props = {
  mesh: PartMesh | null;
};

export function PartViewer({ mesh }: Props) {
  if (!mesh) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-bodor-muted">
        El modelo 3D aparecerá aquí.
      </div>
    );
  }

  const box = new THREE.Box3();
  const positions = mesh.positions;
  for (let i = 0; i < positions.length; i += 3) {
    box.expandByPoint(
      new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]),
    );
  }
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 1);

  return (
    <Canvas
      camera={{ position: [maxDim * 1.2, maxDim * 0.8, maxDim * 1.2], fov: 45, near: 0.1, far: maxDim * 20 }}
    >
      <color attach="background" args={["#0b0f14"]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[maxDim, maxDim * 2, maxDim]} intensity={1.0} />
      <directionalLight position={[-maxDim, -maxDim, maxDim]} intensity={0.3} />
      <Suspense fallback={null}>
        <PartGeometry mesh={mesh} />
      </Suspense>
      <Grid
        args={[maxDim * 4, maxDim * 4]}
        cellSize={Math.max(maxDim / 40, 1)}
        sectionSize={Math.max(maxDim / 4, 1)}
        sectionColor="#1f2a36"
        cellColor="#121820"
        fadeDistance={maxDim * 4}
        position={[0, -maxDim * 0.6, 0]}
        infiniteGrid
      />
      <OrbitControls makeDefault />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={["#ff6b1a", "#66d9a8", "#6ba6ff"]} />
      </GizmoHelper>
    </Canvas>
  );
}

"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  GizmoHelper,
  GizmoViewport,
  Grid,
  Html,
} from "@react-three/drei";
import * as THREE from "three";
import type { Mesh as PartMesh } from "@/lib/occ/mesh-from-shape";
import type { PartSpec } from "@/lib/part-spec";

type FeatureMarker = {
  x: number;
  y: number;
  z: number;
  label: string;
  kind: "hole" | "slot" | "cutout";
};

type Props = {
  mesh: PartMesh | null;
  spec?: PartSpec;
};

export function PartViewer({ mesh, spec }: Props) {
  if (!mesh) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-bodor-muted">
        El modelo 3D aparecerá aquí.
      </div>
    );
  }
  const markers = spec ? computeMarkers(spec) : [];
  return <ViewerInner mesh={mesh} markers={markers} />;
}

function ViewerInner({
  mesh,
  markers,
}: {
  mesh: PartMesh;
  markers: FeatureMarker[];
}) {
  const { center, size, diag, initialPos } = useMemo(() => {
    const box = new THREE.Box3();
    for (let i = 0; i < mesh.positions.length; i += 3) {
      box.expandByPoint(
        new THREE.Vector3(
          mesh.positions[i],
          mesh.positions[i + 1],
          mesh.positions[i + 2],
        ),
      );
    }
    const c = new THREE.Vector3();
    box.getCenter(c);
    const s = new THREE.Vector3();
    box.getSize(s);
    const d = Math.max(s.length(), 1);
    const distance = d * 1.4;
    return {
      center: c,
      size: s,
      diag: d,
      initialPos: [
        c.x + distance * 0.7,
        c.y + distance * 0.5,
        c.z + distance * 0.7,
      ] as [number, number, number],
    };
  }, [mesh]);

  const [resetTick, setResetTick] = useState(0);

  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{
          position: initialPos,
          fov: 35,
          near: diag / 1000,
          far: diag * 50,
        }}
      >
        <color attach="background" args={["#0b0f14"]} />
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[size.x * 2, size.y * 4, size.z * 4]}
          intensity={1.0}
        />
        <directionalLight
          position={[-size.x, -size.y, size.z]}
          intensity={0.35}
        />
        <Suspense fallback={null}>
          <PartGeometry mesh={mesh} />
          <FeatureMarkers markers={markers} />
        </Suspense>
        <Grid
          args={[diag * 4, diag * 4]}
          cellSize={Math.max(diag / 40, 1)}
          sectionSize={Math.max(diag / 4, 10)}
          sectionColor="#1f2a36"
          cellColor="#121820"
          fadeDistance={diag * 4}
          position={[center.x, center.y - size.y * 0.6, center.z]}
          infiniteGrid
        />
        <OrbitControls
          makeDefault
          target={[center.x, center.y, center.z]}
        />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport
            axisColors={["#ff6b1a", "#66d9a8", "#6ba6ff"]}
          />
        </GizmoHelper>
        <CameraResetter
          position={initialPos}
          target={center}
          tick={resetTick}
        />
      </Canvas>
      <button
        type="button"
        onClick={() => setResetTick((t) => t + 1)}
        className="absolute right-2 top-2 z-10 rounded border border-bodor-line bg-bodor-bg/85 px-2.5 py-1.5 text-[11px] text-bodor-text hover:border-bodor-accent/60"
      >
        Encajar vista
      </button>
      <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded border border-bodor-line bg-bodor-bg/80 px-2 py-1 text-[10px] text-bodor-muted">
        ● rojo = agujero · ● naranja = slot · ● violeta = recorte
      </div>
    </div>
  );
}

function PartGeometry({ mesh }: { mesh: PartMesh }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    g.computeBoundingBox();
    return g;
  }, [mesh]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#c0c8d0" metalness={0.8} roughness={0.35} />
    </mesh>
  );
}

function CameraResetter({
  position,
  target,
  tick,
}: {
  position: [number, number, number];
  target: THREE.Vector3;
  tick: number;
}) {
  const { camera, controls } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera;
    controls: { target: THREE.Vector3; update: () => void } | null;
  };
  useEffect(() => {
    camera.position.set(position[0], position[1], position[2]);
    camera.up.set(0, 0, 1);
    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
    camera.lookAt(target);
  }, [tick, camera, controls, position, target]);
  return null;
}

function FeatureMarkers({ markers }: { markers: FeatureMarker[] }) {
  if (!markers.length) return null;
  const COLOR: Record<FeatureMarker["kind"], string> = {
    hole: "#ff3b30",
    slot: "#ff9500",
    cutout: "#5e5ce6",
  };
  return (
    <>
      {markers.map((m, i) => (
        <Html
          key={i}
          position={[m.x, m.y, m.z]}
          center
          zIndexRange={[100, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div
            style={{
              transform: "translate(-50%, -50%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
            }}
          >
            <div
              title={m.label}
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: COLOR[m.kind],
                border: "1.5px solid white",
                boxShadow: "0 0 4px rgba(0,0,0,0.7)",
              }}
            />
            <div
              style={{
                fontSize: 9,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                color: "white",
                background: "rgba(11, 15, 20, 0.85)",
                padding: "1px 4px",
                borderRadius: 3,
                whiteSpace: "nowrap",
                border: `1px solid ${COLOR[m.kind]}`,
              }}
            >
              {m.label}
            </div>
          </div>
        </Html>
      ))}
    </>
  );
}

function computeMarkers(spec: PartSpec): FeatureMarker[] {
  const markers: FeatureMarker[] = [];
  const pr = spec.profile;
  if (pr.kind === "flat_bar") {
    const t = pr.thickness_mm;
    const yDefault = pr.width_mm / 2;
    for (const h of pr.holes) {
      markers.push({
        x: h.position_mm,
        y: h.edge_offset_mm ?? yDefault,
        z: t,
        label: `Ø${h.diameter_mm}`,
        kind: "hole",
      });
    }
    for (const s of pr.slots) {
      markers.push({
        x: s.position_mm,
        y: s.edge_offset_mm ?? yDefault,
        z: t,
        label: `${s.length_mm}×${s.width_mm}`,
        kind: "slot",
      });
    }
    for (const c of pr.cutouts) {
      markers.push({
        x: c.position_mm,
        y: c.edge_offset_mm ?? yDefault,
        z: t,
        label: `▭${c.length_mm}×${c.width_mm}`,
        kind: "cutout",
      });
    }
  } else if (pr.kind === "angle_profile") {
    const t = pr.thickness_mm;
    const onLegA = (pos: number, eo?: number) => ({
      x: pos,
      y:
        eo !== undefined
          ? pr.leg_a_mm - eo
          : t + Math.max(pr.leg_a_mm - t, 0) / 2,
      z: t,
    });
    const onLegB = (pos: number, eo?: number) => ({
      x: pos,
      y: t,
      z:
        eo !== undefined
          ? pr.leg_b_mm - eo
          : t + Math.max(pr.leg_b_mm - t, 0) / 2,
    });
    for (const h of pr.holes) {
      const p =
        h.leg === "a"
          ? onLegA(h.position_mm, h.edge_offset_mm)
          : onLegB(h.position_mm, h.edge_offset_mm);
      markers.push({ ...p, label: `Ø${h.diameter_mm}`, kind: "hole" });
    }
    for (const s of pr.slots) {
      const p =
        s.leg === "a"
          ? onLegA(s.position_mm, s.edge_offset_mm)
          : onLegB(s.position_mm, s.edge_offset_mm);
      markers.push({
        ...p,
        label: `${s.length_mm}×${s.width_mm}`,
        kind: "slot",
      });
    }
    for (const c of pr.cutouts) {
      const p =
        c.leg === "a"
          ? onLegA(c.position_mm, c.edge_offset_mm)
          : onLegB(c.position_mm, c.edge_offset_mm);
      markers.push({
        ...p,
        label: `▭${c.length_mm}×${c.width_mm}`,
        kind: "cutout",
      });
    }
  }
  return markers;
}

// Suppress unused import warning until we actually use refs.
void useRef;

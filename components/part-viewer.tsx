"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  GizmoHelper,
  GizmoViewport,
  Grid,
  Html,
  Bounds,
  useBounds,
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
  // Compute bounds for diagnostics and the grid placement. Camera
  // fitting is handled by drei's <Bounds fit clip observe> which uses
  // Three.js's own projection math — much more reliable than the
  // manual FOV formula we had before.
  const { center, size, diag, tris } = useMemo(() => {
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
    return {
      center: c,
      size: s,
      diag: d,
      tris: Math.floor(mesh.indices.length / 3),
    };
  }, [mesh]);

  const [resetTick, setResetTick] = useState(0);
  const emptyMesh = tris === 0 || diag < 0.5;

  return (
    <div className="relative h-full w-full">
      {emptyMesh && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-bodor-bg/90 p-6 text-center text-sm text-bodor-bad">
          La pieza generada está vacía (0 triángulos). Probablemente un slot o
          recorte demasiado grande borró todo el material. Revisa las cotas en
          el editor.
        </div>
      )}
      <Canvas
        camera={{
          // Initial position is a long-axis 3/4 view. <Bounds fit> will
          // reposition it correctly on mount, so these numbers are
          // only a fallback if Bounds fails.
          position: [diag * 1.5, diag * 0.8, diag * 1.5],
          fov: 35,
          near: 0.01,
          far: Math.max(diag * 200, 1000),
        }}
      >
        <color attach="background" args={["#d8ecd6"]} />
        <ambientLight intensity={0.7} />
        <directionalLight
          position={[size.x * 2, size.y * 4, size.z * 4]}
          intensity={1.6}
        />
        <directionalLight
          position={[-size.x, -size.y, size.z]}
          intensity={0.6}
        />

        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.25}>
            <PartGeometry mesh={mesh} />
            <BoundsResetter tick={resetTick} />
          </Bounds>
          <FeatureMarkers markers={markers} />
        </Suspense>

        <Grid
          args={[diag * 4, diag * 4]}
          cellSize={Math.max(diag / 40, 1)}
          sectionSize={Math.max(diag / 4, 10)}
          sectionColor="#5a8a5a"
          cellColor="#a8c9a8"
          fadeDistance={diag * 4}
          position={[center.x, center.y - size.y * 0.6, center.z]}
          infiniteGrid
        />
        <OrbitControls makeDefault />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport
            axisColors={["#ff6b1a", "#66d9a8", "#6ba6ff"]}
          />
        </GizmoHelper>
      </Canvas>
      <button
        type="button"
        onClick={() => setResetTick((t) => t + 1)}
        className="absolute right-2 top-2 z-10 rounded border border-bodor-bg/30 bg-white/90 px-2.5 py-1.5 text-[11px] font-semibold text-bodor-bg shadow hover:bg-white"
      >
        Encajar vista
      </button>
      <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded border border-bodor-bg/30 bg-white/90 px-2 py-1 text-[10px] text-bodor-bg shadow">
        ● rojo = agujero · ● naranja = slot · ● violeta = recorte
      </div>
      <div className="pointer-events-none absolute bottom-2 right-2 z-10 rounded border border-bodor-bg/20 bg-white/85 px-2 py-1 text-[10px] tabular-nums text-bodor-bg shadow">
        {Math.round(size.x)}×{Math.round(size.y)}×{Math.round(size.z)} mm ·
        {" "}{tris.toLocaleString("es-ES")} triángulos
      </div>
    </div>
  );
}

function BoundsResetter({ tick }: { tick: number }) {
  const api = useBounds();
  useEffect(() => {
    // useBounds() returns null when the component is rendered outside
    // a <Bounds> provider, or during the brief window before Bounds
    // has registered its context. Bail out instead of crashing the
    // whole canvas — Bounds will still auto-fit on its own observe.
    if (!api || typeof api.refresh !== "function") return;
    api.refresh().fit();
  }, [tick, api]);
  return null;
}

function PartGeometry({ mesh }: { mesh: PartMesh }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }, [mesh]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color="#3a4a5e"
        metalness={0.55}
        roughness={0.45}
      />
    </mesh>
  );
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
                width: 11,
                height: 11,
                borderRadius: "50%",
                background: COLOR[m.kind],
                border: "1.5px solid #0b0f14",
                boxShadow: "0 0 6px rgba(0,0,0,0.4)",
              }}
            />
            <div
              style={{
                fontSize: 10,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                color: "#0b0f14",
                background: "rgba(255, 255, 255, 0.95)",
                padding: "1px 5px",
                borderRadius: 3,
                whiteSpace: "nowrap",
                border: `1.5px solid ${COLOR[m.kind]}`,
                fontWeight: 600,
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

// Suppress unused import lint while still keeping useRef + useThree
// imported in case we re-introduce camera state later.
void useRef;
void useThree;

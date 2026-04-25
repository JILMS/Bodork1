"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import * as Comlink from "comlink";
import { Dropzone } from "@/components/dropzone";
import { MaterialForm, type Hints } from "@/components/material-form";
import { PartsList } from "@/components/parts-list";
import { PartEditor } from "@/components/part-editor";
import { SaveDialog, type SaveFormat } from "@/components/save-dialog";
import {
  ProgressStepper,
  type StepId,
  type StepInfo,
} from "@/components/progress-stepper";
import { fileToUploadPayload } from "@/lib/image-utils";
import type { Drawing, PartSpec } from "@/lib/part-spec";
import type { Mesh } from "@/lib/occ/mesh-from-shape";
import { getOccWorker } from "@/lib/occ/client";
import type { WorkerProgress } from "@/lib/occ/worker";

const PartViewer = dynamic(
  () => import("@/components/part-viewer").then((m) => m.PartViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-bodor-muted">
        Cargando visor 3D…
      </div>
    ),
  },
);

type PartResult = {
  mesh: Mesh;
  watertight: boolean;
};

type Phase =
  | "idle"
  | "analyzing"
  | "awaiting_review"
  | "building"
  | "ready"
  | "error";
type EngineStatus = "pending" | "loading" | "ready";
type EngineBytes = { loaded: number; total: number; files: number };

type Progress = {
  steps: Record<StepId, StepInfo>;
  order: StepId[];
};

const INITIAL_PROGRESS: Progress = {
  order: ["compress", "analyze", "engine", "build", "step"],
  steps: {
    compress: {
      id: "compress",
      label: "Preparar archivo",
      state: "pending",
      estimateRangeSec: [0, 1],
    },
    analyze: {
      id: "analyze",
      label: "Interpretar plano con IA",
      state: "pending",
      estimateRangeSec: [2, 7],
    },
    engine: {
      id: "engine",
      label: "Cargar motor CAD",
      state: "pending",
      estimateRangeSec: [5, 20],
      note: "Sólo la primera vez · se precarga en segundo plano",
    },
    build: {
      id: "build",
      label: "Construir sólido 3D",
      state: "pending",
      estimateRangeSec: [1, 4],
    },
    step: {
      id: "step",
      label: "Exportar archivo",
      state: "pending",
      estimateRangeSec: [0, 2],
    },
  },
};

function updateStep(
  prev: Progress,
  id: StepId,
  patch: Partial<StepInfo>,
): Progress {
  return {
    ...prev,
    steps: { ...prev.steps, [id]: { ...prev.steps[id], ...patch } },
  };
}

export default function SketchToStep() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [engine, setEngine] = useState<EngineStatus>("pending");
  const [engineBytes, setEngineBytes] = useState<EngineBytes | null>(null);
  const [hints, setHints] = useState<Hints>({
    default_material: "hierro",
    default_thickness_mm: 10,
    force_profile_kind: "auto",
    force_corner_radius_mm: 0,
  });
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [selected, setSelected] = useState(0);
  const [results, setResults] = useState<Record<number, PartResult>>({});
  const [progress, setProgress] = useState<Progress>(INITIAL_PROGRESS);
  const [error, setError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const engineBytesRef = useRef<EngineBytes | null>(null);
  engineBytesRef.current = engineBytes;

  useEffect(() => {
    let cancelled = false;
    setEngine("loading");
    (async () => {
      try {
        const worker = getOccWorker();
        const onProg = (evt: WorkerProgress) => {
          if (cancelled) return;
          if (evt.kind === "engine_progress") {
            setEngineBytes({
              loaded: evt.loaded,
              total: evt.total,
              files: evt.files,
            });
          }
        };
        await worker.preload(Comlink.proxy(onProg));
        if (!cancelled) setEngine("ready");
      } catch {
        // swallow
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stepsArray: StepInfo[] = useMemo(() => {
    const arr = progress.order.map((id) => ({ ...progress.steps[id] }));
    const engineRow = arr.find((s) => s.id === "engine");
    if (
      engineRow &&
      engineRow.state === "active" &&
      engineBytes &&
      engineBytes.total > 0
    ) {
      engineRow.progress = {
        loaded: engineBytes.loaded,
        total: engineBytes.total,
      };
      engineRow.note = `${engineBytes.files} módulos WASM`;
    }
    return arr;
  }, [progress, engineBytes]);

  const preloadStep: StepInfo = useMemo(() => {
    const s: StepInfo = {
      id: "engine",
      label: "Motor CAD",
      state: engine === "ready" ? "done" : "active",
      estimateRangeSec: [5, 20],
      note:
        engine === "ready"
          ? "Listo"
          : engineBytes
            ? `${engineBytes.files} módulos WASM`
            : "Descargando…",
    };
    if (engine !== "ready" && engineBytes && engineBytes.total > 0) {
      s.progress = { loaded: engineBytes.loaded, total: engineBytes.total };
    }
    return s;
  }, [engine, engineBytes]);

  const handleFile = useCallback(
    async (file: File) => {
      setPhase("analyzing");
      setDrawing(null);
      setResults({});
      setSelected(0);
      setError(null);
      setProgress(() => {
        const base = INITIAL_PROGRESS;
        if (engine === "ready") {
          return updateStep(base, "engine", {
            state: "done",
            elapsedMs: 0,
            note: "Ya estaba en caché",
          });
        }
        return base;
      });

      const markActive = (id: StepId, note?: string) =>
        setProgress((p) =>
          updateStep(p, id, { state: "active", ...(note ? { note } : {}) }),
        );
      const markDone = (id: StepId, elapsedMs: number, note?: string) =>
        setProgress((p) =>
          updateStep(p, id, {
            state: "done",
            elapsedMs,
            ...(note ? { note } : {}),
          }),
        );

      try {
        const t0 = Date.now();
        markActive("compress");
        const { base64, media_type, is_pdf } = await fileToUploadPayload(file);
        markDone(
          "compress",
          Date.now() - t0,
          is_pdf ? "PDF enviado directo" : undefined,
        );

        const t1 = Date.now();
        markActive("analyze");
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_base64: base64,
            media_type,
            hints: {
              default_material: hints.default_material,
              default_thickness_mm: hints.default_thickness_mm,
              force_profile_kind:
                hints.force_profile_kind === "auto"
                  ? undefined
                  : hints.force_profile_kind,
              force_corner_radius_mm:
                hints.force_corner_radius_mm > 0
                  ? hints.force_corner_radius_mm
                  : undefined,
            },
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `Error ${res.status}`);
        }
        const { drawing: raw } = (await res.json()) as { drawing: Drawing };
        const d = applyClientHints(raw, hints);
        setDrawing(d);
        const missingCount = d.missing_fields?.length ?? 0;
        markDone(
          "analyze",
          Date.now() - t1,
          `${d.parts.length} pieza${d.parts.length === 1 ? "" : "s"}${
            missingCount > 0
              ? ` · ${missingCount} cota${missingCount === 1 ? "" : "s"} a revisar`
              : ""
          }`,
        );
        setPhase("awaiting_review");
      } catch (e) {
        const msg = (e as Error).message;
        setError(msg);
        setProgress((p) => {
          const activeId =
            p.order.find((id) => p.steps[id].state === "active") ?? "analyze";
          return updateStep(p, activeId, { state: "error", error: msg });
        });
        setPhase("error");
      }
    },
    [engine, hints],
  );

  const handleBuild = useCallback(async () => {
    if (!drawing) return;
    setPhase("building");
    setError(null);
    setResults({});

    const markActive = (id: StepId, note?: string) =>
      setProgress((p) =>
        updateStep(p, id, { state: "active", ...(note ? { note } : {}) }),
      );
    const markDone = (id: StepId, elapsedMs: number, note?: string) =>
      setProgress((p) =>
        updateStep(p, id, {
          state: "done",
          elapsedMs,
          ...(note ? { note } : {}),
        }),
      );

    try {
      const worker = getOccWorker();
      await worker.clearCache();
      const next: Record<number, PartResult> = {};
      let engineStart: number | null = null;
      let buildTotalMs = 0;

      const onProgress = (evt: WorkerProgress) => {
        switch (evt.kind) {
          case "loading_engine":
            engineStart = Date.now();
            markActive("engine");
            break;
          case "engine_progress":
            setEngineBytes({
              loaded: evt.loaded,
              total: evt.total,
              files: evt.files,
            });
            break;
          case "engine_ready":
            if (engineStart !== null) {
              markDone("engine", Date.now() - engineStart);
            } else {
              markDone("engine", 0, "Ya estaba en caché");
            }
            setEngine("ready");
            break;
          case "building_part":
            markActive(
              "build",
              `Pieza ${evt.partIndex + 1} de ${evt.totalParts}`,
            );
            break;
          case "tessellating":
            setProgress((p) =>
              updateStep(p, "build", {
                note: `Pieza ${evt.partIndex + 1}: mallando para el visor…`,
              }),
            );
            break;
        }
      };
      const proxiedProgress = Comlink.proxy(onProgress);

      for (let i = 0; i < drawing.parts.length; i++) {
        const partT = Date.now();
        // Bodor K1 trick: pletinas (flat bars) are always sent to the
        // machine as a fake angle profile (leg_b ≈ 1 mm) so the CAM
        // accepts them. We do this transparently right before building.
        const specForBuild = pletinaToFakeAngle(drawing.parts[i]);
        const out = await worker.buildPart(
          specForBuild,
          i,
          drawing.parts.length,
          proxiedProgress,
        );
        next[i] = out as PartResult;
        setResults({ ...next });
        buildTotalMs += Date.now() - partT;
      }
      markDone("build", buildTotalMs);
      // The exporter is lazy now — mark it as "pending save" until the
      // user clicks Guardar.
      setProgress((p) =>
        updateStep(p, "step", {
          state: "pending",
          note: "Pulsa Guardar archivo cuando estés listo",
        }),
      );
      setPhase("ready");
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      setProgress((p) => {
        const activeId =
          p.order.find((id) => p.steps[id].state === "active") ?? "build";
        return updateStep(p, activeId, { state: "error", error: msg });
      });
      setPhase("error");
    }
  }, [drawing]);

  const handleSave = useCallback(
    async ({ filename, format }: { filename: string; format: SaveFormat }) => {
      const worker = getOccWorker();
      const t0 = Date.now();
      setProgress((p) =>
        updateStep(p, "step", {
          state: "active",
          note: `Generando ${format.toUpperCase()}…`,
        }),
      );
      const out = await worker.exportPart(selected, format);
      const part: BlobPart =
        out.content instanceof Uint8Array
          ? new Uint8Array(
              out.content.buffer as ArrayBuffer,
              out.content.byteOffset,
              out.content.byteLength,
            )
          : out.content;
      const blob = new Blob([part], { type: out.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}.${out.extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setProgress((p) =>
        updateStep(p, "step", {
          state: "done",
          elapsedMs: Date.now() - t0,
          note: `${out.extension.toUpperCase()} · ${(out.bytes / 1024).toFixed(1)} KB`,
        }),
      );
    },
    [selected],
  );

  const currentResult = drawing ? results[selected] : undefined;
  const currentName = drawing?.parts[selected]?.name ?? `pieza_${selected + 1}`;
  const isWorking =
    phase === "analyzing" || phase === "building";
  const showEditor =
    drawing &&
    (phase === "awaiting_review" ||
      phase === "ready" ||
      phase === "building");

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-6xl flex-col gap-4 p-3 sm:p-5 lg:p-6">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b border-bodor-line pb-3">
        <div>
          <h1 className="text-lg font-semibold sm:text-xl">
            Bodor Sketch → STEP
          </h1>
          <p className="text-[11px] text-bodor-muted sm:text-xs">
            Foto o PDF del plano → sólido B-Rep estanco → archivo STEP/STL
            para la K1.{" "}
            <span className="text-bodor-accent">
              La Bodor K1 empieza a cortar por el extremo izquierdo (X=0).
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <EngineBadge status={engine} />
          <PhaseBadge phase={phase} />
        </div>
      </header>

      <div className="grid flex-1 gap-4 lg:grid-cols-[360px_1fr]">
        <aside className="flex flex-col gap-4">
          <Dropzone onFile={handleFile} disabled={isWorking} />
          <MaterialForm value={hints} onChange={setHints} />

          {!drawing && engine !== "ready" && (
            <div className="rounded-lg border border-bodor-line bg-bodor-panel/60 p-3">
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-bodor-muted">
                Motor CAD (precarga)
              </h2>
              <ProgressStepper steps={[preloadStep]} />
              <p className="mt-2 text-[10px] text-bodor-muted">
                Se descarga ~15 MB de WebAssembly la primera vez. Después
                queda cacheado y este paso es instantáneo.
              </p>
            </div>
          )}

          {(isWorking || phase === "ready" || phase === "error") && (
            <div className="rounded-lg border border-bodor-line bg-bodor-panel/60 p-3">
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-bodor-muted">
                Progreso
              </h2>
              <ProgressStepper steps={stepsArray} />
            </div>
          )}

          {drawing && (
            <>
              <PartsList
                drawing={drawing}
                selected={selected}
                onSelect={setSelected}
              />
              {drawing.parts.some((p) => p.profile.kind === "flat_bar") && (
                <div className="rounded border border-bodor-accent/40 bg-bodor-accent/5 px-3 py-2 text-[11px] text-bodor-accent">
                  Las pletinas se exportarán como falso ángulo en L
                  (leg ≈ {FAKE_LEG_B_MM} mm) para que el CAM de la K1 las
                  acepte. La cara con los agujeros será la del ala marcada
                  en el plano. Cantidad enviada: 1.
                </div>
              )}
            </>
          )}

          {showEditor && drawing && (
            <PartEditor
              drawing={drawing}
              onChange={setDrawing}
              onBuild={handleBuild}
              canBuild={engine === "ready"}
              isBuilding={phase === "building"}
            />
          )}

          {currentResult && (
            <div className="flex flex-col gap-2">
              <div
                className={`text-xs ${
                  currentResult.watertight
                    ? "text-emerald-400"
                    : "text-amber-400"
                }`}
              >
                {currentResult.watertight
                  ? "Sólido estanco ✓"
                  : "Atención: el sólido podría no ser estanco."}
              </div>
              <button
                type="button"
                onClick={() => setSaveOpen(true)}
                className="h-11 w-full rounded bg-bodor-accent px-4 text-sm font-semibold text-bodor-bg transition-colors hover:bg-bodor-accent/90"
              >
                Guardar archivo
              </button>
            </div>
          )}

          {error && (
            <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </aside>

        <section className="relative h-[55vh] min-h-[320px] overflow-hidden rounded-lg border border-bodor-line bg-bodor-panel lg:h-auto">
          <PartViewer mesh={currentResult?.mesh ?? null} />
          {!currentResult && drawing && phase === "awaiting_review" && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-[11px] text-bodor-muted">
              Revisa las cotas a la izquierda y pulsa <em>Construir 3D</em>
              <br />para ver aquí el sólido.
            </div>
          )}
        </section>
      </div>

      <footer className="pb-2 text-center text-[10px] text-bodor-muted">
        Bodor K1 · 3 kW · O₂/N₂ · STEP AP214 en milímetros · origen X=0 en
        extremo izquierdo
        {process.env.NEXT_PUBLIC_BUILD_ID && (
          <>
            {" · "}
            <span title="Hash del commit desplegado">
              build {process.env.NEXT_PUBLIC_BUILD_ID}
            </span>
          </>
        )}
      </footer>

      <SaveDialog
        open={saveOpen}
        defaultName={currentName}
        onClose={() => setSaveOpen(false)}
        onSave={handleSave}
      />
    </main>
  );
}

// Bodor K1 trick: flat bars (pletinas) cannot be cut directly by the
// machine, but the postprocessor accepts angle (L) profiles. Real
// shop workflow is to send the pletina as an L with a tiny second leg
// (≈1 mm) and one piece in the order; the machine then cuts the
// outline of the flat face. We do the conversion silently right
// before building so the UI keeps showing "Pletina" while the STEP
// shipped to the machine is the L variant.
const FAKE_LEG_B_MM = 1;

function pletinaToFakeAngle(p: PartSpec): PartSpec {
  if (p.profile.kind !== "flat_bar") return p;
  const fb = p.profile;
  const newHoles = fb.holes.map((h) => ({
    diameter_mm: h.diameter_mm,
    position_mm: h.position_mm,
    // flat_bar edge_offset is from Y=0 (one edge); angle leg-a
    // edge_offset is from Y=leg_a (outer edge). Flip so the hole
    // ends up at the same physical Y in the L cross-section.
    edge_offset_mm:
      fb.width_mm - (h.edge_offset_mm ?? fb.width_mm / 2),
    type: h.type,
    leg: "a" as const,
  }));
  return {
    ...p,
    // The STEP shipped to the machine is one geometry; nesting /
    // quantity is handled separately in the CAM. Force quantity = 1
    // for the fake-L conversion as the user requested.
    quantity: 1,
    notes:
      (p.notes ? p.notes + " · " : "") +
      `Enviada como falsa L (truco Bodor, ala B = ${FAKE_LEG_B_MM} mm, qty=1)`,
    profile: {
      kind: "angle_profile",
      length_mm: fb.length_mm,
      leg_a_mm: fb.width_mm,
      leg_b_mm: FAKE_LEG_B_MM,
      thickness_mm: fb.thickness_mm,
      holes: newHoles,
      ends: fb.ends,
    },
  };
}

function applyClientHints(drawing: Drawing, hints: Hints): Drawing {
  return {
    ...drawing,
    parts: drawing.parts.map((p) => {
      const pr = p.profile;
      let profile = pr;
      if (
        hints.force_corner_radius_mm > 0 &&
        (pr.kind === "square_tube" || pr.kind === "rectangular_tube") &&
        (pr.corner_radius_mm === undefined || pr.corner_radius_mm === 0)
      ) {
        profile = { ...pr, corner_radius_mm: hints.force_corner_radius_mm };
      }
      const material =
        p.material && p.material !== "acero_carbono"
          ? p.material
          : hints.default_material;
      return { ...p, material, profile };
    }),
  };
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const map: Record<Phase, { text: string; cls: string }> = {
    idle: { text: "Listo", cls: "text-bodor-muted" },
    analyzing: { text: "Analizando…", cls: "text-bodor-accent" },
    awaiting_review: { text: "Revisa cotas", cls: "text-amber-300" },
    building: { text: "Construyendo 3D…", cls: "text-bodor-accent" },
    ready: { text: "Preparado", cls: "text-emerald-400" },
    error: { text: "Error", cls: "text-red-400" },
  };
  const { text, cls } = map[phase];
  return <span className={`text-xs ${cls}`}>{text}</span>;
}

function EngineBadge({ status }: { status: EngineStatus }) {
  if (status === "ready") {
    return (
      <span
        className="flex items-center gap-1.5 text-[10px] text-emerald-400"
        title="Motor CAD precargado"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Motor CAD listo
      </span>
    );
  }
  if (status === "loading") {
    return (
      <span
        className="flex items-center gap-1.5 text-[10px] text-bodor-muted"
        title="Descargando el motor CAD (WASM) en segundo plano"
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-bodor-accent" />
        Motor CAD cargando…
      </span>
    );
  }
  return null;
}

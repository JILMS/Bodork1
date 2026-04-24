"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import * as Comlink from "comlink";
import { Dropzone } from "@/components/dropzone";
import { MaterialForm, type Hints } from "@/components/material-form";
import { PartsList } from "@/components/parts-list";
import { DownloadButton } from "@/components/download-button";
import {
  ProgressStepper,
  type StepId,
  type StepInfo,
} from "@/components/progress-stepper";
import { fileToUploadPayload } from "@/lib/image-utils";
import type { Drawing } from "@/lib/part-spec";
import type { Mesh } from "@/lib/occ/mesh-from-shape";
import { getOccWorker } from "@/lib/occ/client";
import type { WorkerProgress } from "@/lib/occ/worker";

// Isolate the 3D viewer + r3f/drei/three imports behind a client-only
// dynamic boundary so any load-time failure in those packages does not
// crash the whole page on first render.
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
  stepContent: string;
  watertight: boolean;
};

type Phase = "idle" | "working" | "ready" | "error";
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
      label: "Exportar STEP",
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

  // Keep a ref to the latest engineBytes so the buildPart flow can also
  // display byte-level progress if the preload didn't finish in time.
  const engineBytesRef = useRef<EngineBytes | null>(null);
  engineBytesRef.current = engineBytes;

  // Preload OCC WASM on mount with byte-level progress reporting.
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
        if (!cancelled) {
          setEngine("ready");
        }
      } catch {
        // Swallow: a real user action will surface the error via the
        // normal error path.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stepsArray: StepInfo[] = useMemo(() => {
    const arr = progress.order.map((id) => ({ ...progress.steps[id] }));
    // Attach live engine bytes to the active engine row.
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
      setPhase("working");
      setDrawing(null);
      setResults({});
      setSelected(0);
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
        markDone(
          "analyze",
          Date.now() - t1,
          `${d.parts.length} pieza${d.parts.length === 1 ? "" : "s"} detectada${d.parts.length === 1 ? "" : "s"}`,
        );

        const worker = getOccWorker();
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
            case "writing_step":
              markActive("step", `Pieza ${evt.partIndex + 1}`);
              break;
          }
        };
        const proxiedProgress = Comlink.proxy(onProgress);

        for (let i = 0; i < d.parts.length; i++) {
          const partT = Date.now();
          const out = await worker.buildPart(
            d.parts[i],
            i,
            d.parts.length,
            proxiedProgress,
          );
          next[i] = out as PartResult;
          setResults({ ...next });
          buildTotalMs += Date.now() - partT;
        }
        markDone("build", buildTotalMs);
        markDone("step", Math.max(1, buildTotalMs * 0.05));
        setPhase("ready");
      } catch (e) {
        const msg = (e as Error).message;
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

  const currentResult = drawing ? results[selected] : undefined;
  const currentName = drawing?.parts[selected]?.name ?? `pieza_${selected + 1}`;
  const isWorking = phase === "working";

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-6xl flex-col gap-4 p-3 sm:p-5 lg:p-6">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b border-bodor-line pb-3">
        <div>
          <h1 className="text-lg font-semibold sm:text-xl">
            Bodor Sketch → STEP
          </h1>
          <p className="text-[11px] text-bodor-muted sm:text-xs">
            Foto o PDF del plano → sólido B-Rep estanco → archivo .STEP para la
            K1.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <EngineBadge status={engine} />
          <PhaseBadge phase={phase} />
        </div>
      </header>

      <div className="grid flex-1 gap-4 lg:grid-cols-[340px_1fr]">
        <aside className="flex flex-col gap-4">
          <Dropzone onFile={handleFile} disabled={isWorking} />
          <MaterialForm value={hints} onChange={setHints} />

          {!isWorking && phase !== "ready" && phase !== "error" && (
            <div className="rounded-lg border border-bodor-line bg-bodor-panel/60 p-3">
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-bodor-muted">
                Motor CAD (precarga)
              </h2>
              <ProgressStepper steps={[preloadStep]} />
              <p className="mt-2 text-[10px] text-bodor-muted">
                Se descarga ~15 MB de WebAssembly la primera vez. Después queda
                cacheado y este paso es instantáneo.
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
            <PartsList
              drawing={drawing}
              selected={selected}
              onSelect={setSelected}
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
              <DownloadButton
                stepContent={currentResult.stepContent}
                filename={`${currentName}.step`}
              />
            </div>
          )}
        </aside>

        <section className="relative h-[55vh] min-h-[320px] overflow-hidden rounded-lg border border-bodor-line bg-bodor-panel lg:h-auto">
          <PartViewer mesh={currentResult?.mesh ?? null} />
        </section>
      </div>

      <footer className="pb-2 text-center text-[10px] text-bodor-muted">
        Bodor K1 · 3 kW · O₂/N₂ · STEP AP214 en milímetros
      </footer>
    </main>
  );
}

// Post-process the drawing returned by the model with the UI hints:
// - If the user forced a corner radius, inject it into every tube that
//   doesn't already have one.
// - Material override: if the user picked a material explicitly via
//   the form, use it when the model left the default in place.
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
    working: { text: "Procesando…", cls: "text-bodor-accent" },
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

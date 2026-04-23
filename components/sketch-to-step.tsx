"use client";
import { useCallback, useMemo, useState } from "react";
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
import { fileToCompressedBase64 } from "@/lib/image-utils";
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

type Progress = {
  steps: Record<StepId, StepInfo>;
  order: StepId[];
};

const INITIAL_PROGRESS: Progress = {
  order: ["compress", "analyze", "engine", "build", "step"],
  steps: {
    compress: {
      id: "compress",
      label: "Preparar imagen",
      state: "pending",
      estimateRangeSec: [0, 1],
    },
    analyze: {
      id: "analyze",
      label: "Interpretar plano con IA",
      state: "pending",
      estimateRangeSec: [4, 15],
    },
    engine: {
      id: "engine",
      label: "Cargar motor CAD (opencascade)",
      state: "pending",
      estimateRangeSec: [8, 25],
      note: "Sólo la primera vez en tu navegador",
    },
    build: {
      id: "build",
      label: "Construir sólido 3D",
      state: "pending",
      estimateRangeSec: [1, 6],
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
  const [hints, setHints] = useState<Hints>({
    default_material: "acero_carbono",
    default_thickness_mm: 10,
  });
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [selected, setSelected] = useState(0);
  const [results, setResults] = useState<Record<number, PartResult>>({});
  const [progress, setProgress] = useState<Progress>(INITIAL_PROGRESS);

  const stepsArray: StepInfo[] = useMemo(
    () => progress.order.map((id) => progress.steps[id]),
    [progress],
  );

  const handleImage = useCallback(
    async (file: File) => {
      setPhase("working");
      setDrawing(null);
      setResults({});
      setSelected(0);
      setProgress(INITIAL_PROGRESS);

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
      const markError = (id: StepId, error: string) =>
        setProgress((p) => updateStep(p, id, { state: "error", error }));

      try {
        // 1. Compress client-side.
        const t0 = Date.now();
        markActive("compress");
        const { base64, media_type } = await fileToCompressedBase64(file);
        markDone("compress", Date.now() - t0);

        // 2. Analyze with Claude.
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
            },
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `Error ${res.status}`);
        }
        const { drawing: d } = (await res.json()) as { drawing: Drawing };
        setDrawing(d);
        markDone(
          "analyze",
          Date.now() - t1,
          `${d.parts.length} pieza${d.parts.length === 1 ? "" : "s"} detectada${d.parts.length === 1 ? "" : "s"}`,
        );

        // 3 + 4 + 5. Build each part, tracking per-phase progress reported by
        // the worker via a Comlink-proxied callback.
        const worker = getOccWorker();
        const next: Record<number, PartResult> = {};
        let engineStart: number | null = null;
        let buildStart: number | null = null;
        let stepStart: number | null = null;
        let buildTotalMs = 0;
        let stepTotalMs = 0;

        const onProgress = (evt: WorkerProgress) => {
          switch (evt.kind) {
            case "loading_engine":
              engineStart = Date.now();
              markActive("engine");
              break;
            case "engine_ready":
              if (engineStart !== null) {
                markDone("engine", Date.now() - engineStart);
              } else {
                markDone("engine", 0, "Ya estaba en caché");
              }
              break;
            case "building_part":
              if (buildStart === null) buildStart = Date.now();
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
              if (stepStart === null) stepStart = Date.now();
              markActive("step", `Pieza ${evt.partIndex + 1}`);
              break;
          }
        };
        const proxiedProgress = Comlink.proxy(onProgress);

        // If the engine was already loaded in a previous run, the worker
        // will skip "loading_engine" entirely. Pre-mark engine as done in
        // that optimistic case after the first buildPart resolves.
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
          const totalForPart = Date.now() - partT;
          // writing_step inside worker is the tail of the part;
          // we count build = total - (step phase ~100ms proxy).
          buildTotalMs += totalForPart;
        }
        markDone("build", buildTotalMs);
        if (progress.steps.engine.state !== "done") {
          // Defensive: engine should be done by now.
          setProgress((p) =>
            p.steps.engine.state === "active"
              ? updateStep(p, "engine", { state: "done" })
              : p,
          );
        }
        markDone("step", stepTotalMs || Math.max(1, buildTotalMs * 0.05));

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
    [hints, progress.steps.engine.state],
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
            Foto del plano → sólido B-Rep estanco → archivo .STEP para la K1.
          </p>
        </div>
        <PhaseBadge phase={phase} />
      </header>

      <div className="grid flex-1 gap-4 lg:grid-cols-[340px_1fr]">
        <aside className="flex flex-col gap-4">
          <Dropzone onImage={handleImage} disabled={isWorking} />
          <MaterialForm value={hints} onChange={setHints} />

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

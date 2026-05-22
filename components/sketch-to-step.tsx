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
import { OverallProgress } from "@/components/overall-progress";
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
  // The spec actually built (after the pletina→fake-L conversion etc).
  // Used by the viewer to draw feature markers in the right frame.
  builtSpec: PartSpec;
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
      label: "Interpretar plano con IA (Opus 4.7)",
      state: "pending",
      estimateRangeSec: [15, 45],
      note: "Contorno + features (2 pasadas)",
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
  const [uploaded, setUploaded] = useState<{
    file: File;
    name: string;
    size: number;
    url: string;
    isPdf: boolean;
  } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const engineBytesRef = useRef<EngineBytes | null>(null);
  engineBytesRef.current = engineBytes;

  // Persist the operator's material / espesor / advanced overrides
  // across sessions so they don't have to set them every time.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("bodor-hints-v1");
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<Hints>;
        setHints((h) => ({ ...h, ...parsed }));
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("bodor-hints-v1", JSON.stringify(hints));
    } catch {
      /* quota exceeded etc, ignore */
    }
  }, [hints]);

  // Clean up the object URL when the uploaded file is replaced or
  // the component unmounts.
  useEffect(() => {
    if (!uploaded) return;
    const url = uploaded.url;
    return () => URL.revokeObjectURL(url);
  }, [uploaded]);

  // Persist the analyzed drawing + the uploaded image to localStorage
  // so that backgrounding the browser on mobile (which reloads the
  // page from scratch and wipes React state) doesn't lose the work —
  // and crucially doesn't force a paid re-analysis. We restore on
  // mount and let the operator press "Construir 3D" again (free,
  // local OCC) to rebuild the mesh.
  useEffect(() => {
    try {
      const rawDrawing = localStorage.getItem("bodor-drawing-v1");
      const rawImg = localStorage.getItem("bodor-image-v1");
      if (rawDrawing) {
        const d = JSON.parse(rawDrawing) as Drawing;
        if (d?.parts?.length) {
          setDrawing(d);
          setPhase("awaiting_review");
        }
      }
      if (rawImg) {
        const meta = JSON.parse(rawImg) as {
          name: string;
          size: number;
          isPdf: boolean;
          dataUrl: string;
        };
        // Recreate a blob URL from the stored data URL so the preview
        // works. The File object can't be restored, so "Reanalizar"
        // won't be available after a reload — but the drawing is
        // already cached, so that's fine.
        fetch(meta.dataUrl)
          .then((r) => r.blob())
          .then((blob) => {
            const file = new File([blob], meta.name, {
              type: meta.isPdf ? "application/pdf" : "image/jpeg",
            });
            setUploaded({
              file,
              name: meta.name,
              size: meta.size,
              url: URL.createObjectURL(blob),
              isPdf: meta.isPdf,
            });
          })
          .catch(() => {});
      }
    } catch {
      /* ignore corrupt / oversized storage */
    }
  }, []);

  useEffect(() => {
    try {
      if (drawing) {
        localStorage.setItem("bodor-drawing-v1", JSON.stringify(drawing));
      } else {
        localStorage.removeItem("bodor-drawing-v1");
      }
    } catch {
      /* quota — ignore */
    }
  }, [drawing]);

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
      // Remember the original file so we can show a thumbnail / name
      // next to the 3D preview.
      setUploaded((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return {
          file,
          name: file.name,
          size: file.size,
          url: URL.createObjectURL(file),
          isPdf: file.type === "application/pdf",
        };
      });
      // Persist a copy of the image so it survives a mobile reload.
      // Only store files small enough to fit localStorage (~4 MB of
      // the ~5 MB origin quota); skip otherwise.
      if (file.size < 3_500_000) {
        try {
          const reader = new FileReader();
          reader.onload = () => {
            try {
              localStorage.setItem(
                "bodor-image-v1",
                JSON.stringify({
                  name: file.name,
                  size: file.size,
                  isPdf: file.type === "application/pdf",
                  dataUrl: reader.result,
                }),
              );
            } catch {
              /* quota — ignore */
            }
          };
          reader.readAsDataURL(file);
        } catch {
          /* ignore */
        }
      }
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
        // Up to 2 retries on a raw network failure (mobile carriers
        // sometimes drop SSE mid-stream on a long analysis).
        let sseResult: { drawing?: unknown; error?: string } | null = null;
        let lastNetError: Error | null = null;
        const payload = JSON.stringify({
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
        });
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (attempt > 0) {
              setProgress((p) =>
                updateStep(p, "analyze", {
                  state: "active",
                  note: `Reintentando (intento ${attempt + 1}/3)…`,
                }),
              );
              await new Promise((r) => setTimeout(r, 1500 * attempt));
            }
            const res = await fetch("/api/analyze", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: payload,
            });
            if (!res.ok || !res.body) {
              throw new Error(`Error ${res.status}`);
            }
            sseResult = await readSSEDrawing(res, (note) =>
              setProgress((p) =>
                updateStep(p, "analyze", { state: "active", note }),
              ),
            );
            break;
          } catch (e) {
            lastNetError = e as Error;
            const msg = lastNetError.message.toLowerCase();
            const isNetErr =
              msg.includes("network") ||
              msg.includes("fetch") ||
              msg.includes("failed to fetch") ||
              msg.includes("load") ||
              msg.includes("abort");
            if (!isNetErr) throw lastNetError;
            // Otherwise loop and retry.
          }
        }
        if (!sseResult) {
          throw new Error(
            (lastNetError?.message ?? "Sin respuesta") +
              " — la red móvil cortó la conexión. Prueba con WiFi o vuelve a intentarlo.",
          );
        }
        if (sseResult.error) throw new Error(sseResult.error);
        if (!sseResult.drawing) throw new Error("Sin respuesta del análisis.");
        const raw = sseResult.drawing as Drawing;
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
        next[i] = {
          mesh: out.mesh,
          watertight: out.watertight,
          builtSpec: specForBuild,
        };
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

  const stepsForOverall: StepInfo[] =
    !drawing && engine !== "ready" ? [preloadStep] : stepsArray;

  const overallLabel =
    phase === "ready"
      ? "Listo"
      : phase === "error"
        ? "Error"
        : phase === "building"
          ? "3D"
          : phase === "analyzing"
            ? "IA"
            : engine === "loading"
              ? "CAD"
              : "—";

  const resetAll = () => {
    setDrawing(null);
    setResults({});
    setSelected(0);
    setError(null);
    setPhase("idle");
    setProgress(INITIAL_PROGRESS);
    setUploaded((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    try {
      localStorage.removeItem("bodor-drawing-v1");
      localStorage.removeItem("bodor-image-v1");
    } catch {
      /* ignore */
    }
  };

  return (
    <main className="min-h-[100dvh] bg-bodor-bg">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-bodor-line bg-bodor-bg/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-bodor-accent to-orange-600 text-bodor-bg shadow-md">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <path d="M3 7l9-4 9 4-9 4-9-4z" />
                <path d="M3 7v10l9 4 9-4V7" />
                <path d="M12 11v10" />
              </svg>
            </span>
            <div className="leading-tight">
              <h1 className="text-sm font-semibold sm:text-base">
                Sketch → STEP
              </h1>
              <p className="text-[10px] text-bodor-muted">
                Bodor K1 · plano → 3D
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <EngineBadge status={engine} />
            <PhaseBadge phase={phase} />
            {(drawing || uploaded) && !isWorking && (
              <button
                type="button"
                onClick={resetAll}
                title="Empezar de nuevo"
                className="rounded-lg border border-bodor-line px-2.5 py-1.5 text-[11px] text-bodor-muted hover:border-bodor-accent/50 hover:text-bodor-text"
              >
                Nuevo
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 p-4 sm:p-6 lg:grid-cols-[380px_1fr] lg:gap-5">
        {/* Sidebar — stacked action cards */}
        <aside className="flex flex-col gap-3">
          {/* Card 1: Upload */}
          <Card title="1 · Subir plano">
            <Dropzone onFile={handleFile} disabled={isWorking} />
            {uploaded && (
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="flex w-full items-center gap-3 rounded-lg border border-bodor-line bg-bodor-bg/60 p-2 text-left transition-colors hover:border-bodor-accent/60"
                >
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-bodor-bg">
                    {uploaded.isPdf ? (
                      <span className="text-[10px] font-bold text-bodor-accent">
                        PDF
                      </span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={uploaded.url}
                        alt="Plano"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-bodor-text">
                      {uploaded.name}
                    </div>
                    <div className="text-[10px] text-bodor-muted">
                      {(uploaded.size / 1024).toFixed(0)} KB · pulsa para
                      ampliar
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleFile(uploaded.file)}
                  disabled={isWorking}
                  className="flex h-9 items-center justify-center gap-2 rounded-lg border border-bodor-accent/40 bg-bodor-accent/10 px-3 text-xs font-semibold text-bodor-accent transition-colors hover:bg-bodor-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                    <path d="M21 3v5h-5" />
                  </svg>
                  Reanalizar con la IA
                </button>
              </div>
            )}
          </Card>

          {/* Card 2: Progress (always visible after any activity) */}
          {(isWorking ||
            phase === "ready" ||
            phase === "error" ||
            (!drawing && engine !== "ready")) && (
            <Card title="2 · Progreso">
              <OverallProgress
                steps={stepsForOverall}
                centerLabel={overallLabel}
              />
              <details className="mt-2">
                <summary className="cursor-pointer select-none text-[10px] text-bodor-muted hover:text-bodor-text">
                  Detalles por fase
                </summary>
                <div className="mt-2">
                  <ProgressStepper steps={stepsForOverall} />
                </div>
              </details>
              {!drawing && engine !== "ready" && (
                <p className="mt-2 text-[10px] text-bodor-muted">
                  Se descarga ~15 MB de WebAssembly la primera vez. Después
                  queda cacheado.
                </p>
              )}
            </Card>
          )}

          {/* Card 3: Material / espesor fallback */}
          <Card
            title="Material / espesor"
            subtitle="Si no aparecen en el plano"
          >
            <MaterialForm value={hints} onChange={setHints} />
          </Card>

          {/* Card 4: Detected parts + editor */}
          {drawing && (
            <Card title="3 · Piezas detectadas">
              <PartsList
                drawing={drawing}
                selected={selected}
                onSelect={setSelected}
              />
              {drawing.parts.some((p) => p.profile.kind === "flat_bar") && (
                <div className="mt-2 rounded border border-bodor-accent/40 bg-bodor-accent/5 px-3 py-2 text-[11px] text-bodor-accent">
                  Regla taller Bodor: las piezas planas se exportan como
                  angular cuadrado (leg = lado corto), espesor = leg /
                  10. La cara dibujada en el plano va al ala A.
                </div>
              )}
              {showEditor && (
                <div className="mt-3">
                  <PartEditor
                    drawing={drawing}
                    onChange={setDrawing}
                    onBuild={handleBuild}
                    canBuild={engine === "ready"}
                    isBuilding={phase === "building"}
                  />
                </div>
              )}
            </Card>
          )}

          {/* Card 5: Save */}
          {currentResult && (
            <Card title="4 · Guardar">
              <div
                className={`mb-2 text-xs ${
                  currentResult.watertight
                    ? "text-bodor-good"
                    : "text-bodor-warn"
                }`}
              >
                {currentResult.watertight
                  ? "✓ Sólido estanco, listo para la K1"
                  : "⚠ Posible no-estanco — revisa antes de cortar"}
              </div>
              <button
                type="button"
                onClick={() => setSaveOpen(true)}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-bodor-accent to-orange-600 px-4 text-sm font-bold uppercase tracking-wider text-bodor-bg shadow-md transition-all hover:brightness-110"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Guardar archivo
              </button>
            </Card>
          )}

          {error && (
            <div className="rounded-lg border border-bodor-bad/50 bg-bodor-bad/10 p-3 text-xs text-bodor-bad">
              {error}
            </div>
          )}
        </aside>

        {/* Main viewer panel */}
        <section className="relative h-[55vh] min-h-[360px] overflow-hidden rounded-2xl border border-bodor-line bg-bodor-panel shadow-xl lg:h-[calc(100dvh-160px)] lg:min-h-0">
          <PartViewer
            mesh={currentResult?.mesh ?? null}
            spec={currentResult?.builtSpec}
          />
          {!currentResult && drawing && phase === "awaiting_review" && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-bodor-muted">
              <div className="rounded-xl bg-bodor-bg/85 px-5 py-4 backdrop-blur-md">
                Revisa las piezas a la izquierda y pulsa
                <br />
                <em className="font-semibold text-bodor-accent">
                  Construir 3D
                </em>{" "}
                para ver aquí el sólido.
              </div>
            </div>
          )}
        </section>
      </div>

      <footer className="mx-auto max-w-7xl px-4 pb-4 text-center text-[10px] text-bodor-muted sm:px-6">
        Bodor K1 · 3 kW · O₂/N₂ · STEP AP214 mm · origen X=0 a la izquierda
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

      {previewOpen && uploaded && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="flex max-h-full max-w-5xl flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 text-bodor-text">
              <span className="truncate text-sm font-semibold">
                {uploaded.name}
              </span>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="rounded border border-bodor-line bg-bodor-panel px-3 py-1.5 text-xs hover:border-bodor-accent/60"
              >
                Cerrar
              </button>
            </div>
            {uploaded.isPdf ? (
              <iframe
                src={uploaded.url}
                title="Plano"
                className="h-[80vh] w-full max-w-5xl rounded-lg border border-bodor-line bg-white"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={uploaded.url}
                alt="Plano original"
                className="max-h-[85vh] max-w-full rounded-lg border border-bodor-line object-contain"
              />
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-bodor-line bg-bodor-panel/60 p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-bodor-text/90">
          {title}
        </h2>
        {subtitle && (
          <span className="text-[10px] text-bodor-muted">{subtitle}</span>
        )}
      </div>
      {children}
    </section>
  );
}

// Bodor K1 workshop rule: the machine NEVER accepts flat plates —
// every piece is sent as a REAL square angle profile, regardless of
// length-to-width ratio. The plan always shows ONE face of the angle.
// Convention:
//   leg_a = leg_b = SHORT side of the rectangle (so it's a square L)
//   length = LONG side
//   thickness = leg / 10 (40 → 4 mm, 80 → 8 mm, 150 → 15 mm), unless
//                         the plan explicitly indicated another value
// All features (holes, slots, cutouts) live on leg "a", which is the
// face the operator drew. We do the conversion silently right before
// building so the UI keeps showing the original rectangle while the
// STEP shipped to the machine is the workshop-correct angle.
const FAKE_LEG_B_MM = 1; // kept for backwards-compat with any prompt notes
const WORKSHOP_THICKNESS_RATIO = 10;

function pletinaToFakeAngle(p: PartSpec): PartSpec {
  if (p.profile.kind !== "flat_bar") return p;
  const fb = p.profile;

  // Identify the long and short sides of the rectangle and whether
  // we need to swap axes so position_mm runs along the long side.
  const long = Math.max(fb.length_mm, fb.width_mm);
  const short = Math.min(fb.length_mm, fb.width_mm);
  const swap = fb.width_mm > fb.length_mm;

  // Workshop thickness rule: leg / 10. If the AI gave us a thickness
  // notably different (more than ±25 % off), trust the plan — those
  // are the "rare cases" the user mentioned. Otherwise snap to the
  // workshop default so 80 mm always means 8 mm, 150 always 15.
  const workshopT = short / WORKSHOP_THICKNESS_RATIO;
  const planT = fb.thickness_mm;
  const planTrusted =
    planT > 0 && Math.abs(planT - workshopT) / workshopT > 0.25;
  const thickness = planTrusted ? planT : workshopT;

  // After swap, what used to be position_mm (X) becomes edge_offset
  // (Y across the leg) and vice-versa. In the angle frame, leg-a
  // edge_offset is measured from the OUTER edge (Y = leg) toward the
  // corner — i.e. (leg - localY).
  const mapXY = (
    rawX: number,
    rawY: number | undefined,
  ): { x: number; y: number } => {
    const localY = rawY ?? fb.width_mm / 2;
    if (swap) {
      // Original (X along width, Y along length) → new (X along
      // length=long=old width, Y along leg=short=old length).
      return { x: localY, y: rawX };
    }
    return { x: rawX, y: localY };
  };
  const flipToLegA = (y: number) => short - y;

  const newHoles = fb.holes.map((h) => {
    const { x, y } = mapXY(h.position_mm, h.edge_offset_mm);
    return {
      diameter_mm: h.diameter_mm,
      position_mm: x,
      edge_offset_mm: flipToLegA(y),
      type: h.type,
      leg: "a" as const,
    };
  });
  const newSlots = fb.slots.map((s) => {
    const { x, y } = mapXY(s.position_mm, s.edge_offset_mm);
    const rotation_deg = swap
      ? ((s.rotation_deg ?? 0) + 90) % 180
      : s.rotation_deg ?? 0;
    return {
      length_mm: s.length_mm,
      width_mm: s.width_mm,
      position_mm: x,
      edge_offset_mm: flipToLegA(y),
      rotation_deg,
      leg: "a" as const,
    };
  });
  const newCutouts = fb.cutouts.map((c) => {
    const { x, y } = mapXY(c.position_mm, c.edge_offset_mm);
    const rotation_deg = swap
      ? ((c.rotation_deg ?? 0) + 90) % 180
      : c.rotation_deg ?? 0;
    return {
      length_mm: c.length_mm,
      width_mm: c.width_mm,
      position_mm: x,
      edge_offset_mm: flipToLegA(y),
      rotation_deg,
      leg: "a" as const,
    };
  });

  return {
    ...p,
    quantity: 1,
    notes:
      (p.notes ? p.notes + " · " : "") +
      `Convertida a angular ${short}×${short} × ${long} mm, espesor ${thickness} mm` +
      (planTrusted ? " (espesor del plano)" : " (regla taller leg/10)"),
    profile: {
      kind: "angle_profile",
      length_mm: long,
      leg_a_mm: short,
      leg_b_mm: short, // SQUARE angle — both legs equal per workshop rule
      thickness_mm: thickness,
      holes: newHoles,
      slots: newSlots,
      cutouts: newCutouts,
      ends: fb.ends,
    },
  };
}

// Reads a Server-Sent Events response from /api/analyze and returns
// the final drawing or an error. Calls onStage with progress notes.
async function readSSEDrawing(
  res: Response,
  onStage: (note: string) => void,
): Promise<{ drawing?: unknown; error?: string }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: { drawing?: unknown; error?: string } = {};
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const ev of events) {
      // Lines starting with ":" are SSE comments (keepalives) — skip.
      const lines = ev.split("\n").filter((l) => !l.startsWith(":"));
      let eventName = "message";
      let dataLine = "";
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
      }
      if (!dataLine) continue;
      let data: unknown;
      try {
        data = JSON.parse(dataLine);
      } catch {
        continue;
      }
      if (eventName === "stage") {
        const stage = (data as { stage?: string }).stage;
        if (stage === "outer_dims")
          onStage("1/2 · Midiendo el contorno exterior…");
        if (stage === "calling_claude")
          onStage("2/2 · Leyendo features internos…");
        if (stage === "fallback_force_tool")
          onStage("Reintentando para forzar el tool…");
      } else if (eventName === "done") {
        result = { drawing: (data as { drawing: unknown }).drawing };
      } else if (eventName === "error") {
        result = { error: (data as { error: string }).error };
      }
    }
  }
  return result;
}

function applyClientHints(drawing: Drawing, hints: Hints): Drawing {
  const newMissing = [...drawing.missing_fields];
  const parts = drawing.parts.map((p, partIndex) => {
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

    // Slots / cutouts that obviously can't fit in the piece are
    // proof that the AI confused the outer rectangle of the plan
    // with one of its inner features. We DROP those mis-detected
    // features outright (better no slot than an hourglass), and
    // flag the piece's dimensions as "to confirm" so the operator
    // types the real values before building.
    if (profile.kind === "flat_bar") {
      const fb = profile;
      const tooBig = (l: number, w: number) =>
        l > fb.length_mm * 0.85 || w > fb.width_mm * 0.85;

      const droppedSlots = fb.slots.filter((s) =>
        tooBig(s.length_mm, s.width_mm),
      );
      const droppedCutouts = fb.cutouts.filter((c) =>
        tooBig(c.length_mm, c.width_mm),
      );
      const cleanSlots = fb.slots.filter(
        (s) => !tooBig(s.length_mm, s.width_mm),
      );
      const cleanCutouts = fb.cutouts.filter(
        (c) => !tooBig(c.length_mm, c.width_mm),
      );

      if (droppedSlots.length || droppedCutouts.length) {
        // The piece's real dimensions are probably mis-read. Force
        // the operator to confirm them.
        const reason =
          `La IA detectó ${droppedSlots.length + droppedCutouts.length} feature(s) más grande(s) que la pieza — confundió cota EXTERIOR del rectángulo con cota INTERIOR del slot. Confirma length y width REALES (cotas de los bordes del rectángulo, normalmente las más grandes del plano).`;
        if (
          !newMissing.some(
            (m) =>
              m.part_index === partIndex &&
              m.field_path === "profile.length_mm",
          )
        ) {
          newMissing.push({
            part_index: partIndex,
            field_path: "profile.length_mm",
            label: "Longitud de la pieza",
            reason,
            current_value: fb.length_mm,
          });
        }
        if (
          !newMissing.some(
            (m) =>
              m.part_index === partIndex &&
              m.field_path === "profile.width_mm",
          )
        ) {
          newMissing.push({
            part_index: partIndex,
            field_path: "profile.width_mm",
            label: "Ancho de la pieza",
            reason,
            current_value: fb.width_mm,
          });
        }
        // Dropped slots / cutouts are silently removed. The operator
        // can re-add them via "Editar a mano" once dimensions are
        // confirmed — listing them as non-editable missing entries
        // would just block the Construir 3D button without offering
        // a real action.
        profile = { ...fb, slots: cleanSlots, cutouts: cleanCutouts };
      }
    }
    return { ...p, material, profile };
  });
  return {
    ...drawing,
    parts,
    missing_fields: newMissing,
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

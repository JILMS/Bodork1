"use client";
import { useState } from "react";
import { Dropzone } from "@/components/dropzone";
import { MaterialForm, type Hints } from "@/components/material-form";
import { PartViewer } from "@/components/part-viewer";
import { PartsList } from "@/components/parts-list";
import { DownloadButton } from "@/components/download-button";
import { fileToCompressedBase64 } from "@/lib/image-utils";
import type { Drawing } from "@/lib/part-spec";
import type { Mesh } from "@/lib/occ/mesh-from-shape";
import { getOccWorker } from "@/lib/occ/client";

type Stage = "idle" | "analyzing" | "building" | "ready" | "error";

type PartResult = {
  mesh: Mesh;
  stepContent: string;
  watertight: boolean;
};

export default function SketchToStep() {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hints, setHints] = useState<Hints>({
    default_material: "acero_carbono",
    default_thickness_mm: 10,
  });
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [selected, setSelected] = useState(0);
  const [results, setResults] = useState<Record<number, PartResult>>({});

  const handleImage = async (file: File) => {
    setError(null);
    setDrawing(null);
    setResults({});
    setSelected(0);
    setStage("analyzing");
    try {
      const { base64, media_type } = await fileToCompressedBase64(file);
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
      setStage("building");

      const worker = getOccWorker();
      const next: Record<number, PartResult> = {};
      for (let i = 0; i < d.parts.length; i++) {
        const out = await worker.buildPart(d.parts[i]);
        next[i] = out as PartResult;
        setResults({ ...next });
      }
      setStage("ready");
    } catch (e) {
      setError((e as Error).message);
      setStage("error");
    }
  };

  const currentResult = drawing ? results[selected] : undefined;
  const currentName = drawing?.parts[selected]?.name ?? `pieza_${selected + 1}`;

  return (
    <main className="mx-auto grid min-h-screen max-w-6xl grid-rows-[auto_1fr] gap-4 p-6">
      <header className="flex items-baseline justify-between border-b border-bodor-line pb-3">
        <div>
          <h1 className="text-xl font-semibold">Bodor Sketch → STEP</h1>
          <p className="text-xs text-bodor-muted">
            Foto del plano → sólido B-Rep estanco → archivo .STEP para la K1.
          </p>
        </div>
        <StageBadge stage={stage} />
      </header>

      <div className="grid grid-cols-[320px_1fr] gap-4">
        <aside className="flex flex-col gap-4">
          <Dropzone onImage={handleImage} disabled={stage === "analyzing" || stage === "building"} />
          <MaterialForm value={hints} onChange={setHints} />
          {drawing && (
            <PartsList
              drawing={drawing}
              selected={selected}
              onSelect={setSelected}
            />
          )}
          {currentResult && (
            <div className="flex flex-col gap-2 text-xs">
              <div
                className={
                  currentResult.watertight
                    ? "text-emerald-400"
                    : "text-amber-400"
                }
              >
                {currentResult.watertight
                  ? "Sólido estanco ✓"
                  : "Atención: el solido podría no ser estanco."}
              </div>
              <DownloadButton
                stepContent={currentResult.stepContent}
                filename={`${currentName}.step`}
              />
            </div>
          )}
          {error && (
            <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </aside>
        <section className="h-[70vh] rounded border border-bodor-line bg-bodor-panel">
          <PartViewer mesh={currentResult?.mesh ?? null} />
        </section>
      </div>
    </main>
  );
}

function StageBadge({ stage }: { stage: Stage }) {
  const map: Record<Stage, { text: string; cls: string }> = {
    idle: { text: "Listo", cls: "text-bodor-muted" },
    analyzing: { text: "Analizando plano…", cls: "text-bodor-accent" },
    building: { text: "Construyendo 3D…", cls: "text-bodor-accent" },
    ready: { text: "Preparado", cls: "text-emerald-400" },
    error: { text: "Error", cls: "text-red-400" },
  };
  const { text, cls } = map[stage];
  return <span className={`text-xs ${cls}`}>{text}</span>;
}

"use client";
import { useEffect, useRef, useState } from "react";

export type SaveFormat = "step" | "stl";

type Props = {
  open: boolean;
  defaultName: string;
  onClose: () => void;
  onSave: (opts: { filename: string; format: SaveFormat }) => Promise<void>;
};

const FORMAT_INFO: Record<
  SaveFormat,
  { label: string; ext: string; desc: string }
> = {
  step: {
    label: "STEP (AP214)",
    ext: "step",
    desc: "Sólido B-Rep en mm. Recomendado para el CAM de la Bodor K1.",
  },
  stl: {
    label: "STL binario",
    ext: "stl",
    desc: "Malla triangulada. Útil para impresión 3D o revisión rápida.",
  },
};

function sanitize(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80)
    || "pieza";
}

export function SaveDialog({ open, defaultName, onClose, onSave }: Props) {
  const [filename, setFilename] = useState(defaultName);
  const [format, setFormat] = useState<SaveFormat>("step");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFilename(defaultName);
      setError(null);
      // Auto-focus the filename field.
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [open, defaultName]);

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ filename: sanitize(filename), format });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-bodor-line bg-bodor-bg p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold">Guardar archivo</h2>

        <label className="mb-3 block text-xs">
          <span className="mb-1 block text-bodor-muted">Nombre del archivo</span>
          <div className="flex h-10 items-stretch overflow-hidden rounded border border-bodor-line bg-bodor-panel">
            <input
              ref={inputRef}
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="flex-1 bg-transparent px-2 text-sm outline-none"
              placeholder="pieza_1"
            />
            <span className="flex items-center border-l border-bodor-line bg-bodor-bg px-2 text-xs text-bodor-muted">
              .{FORMAT_INFO[format].ext}
            </span>
          </div>
        </label>

        <fieldset className="mb-4 flex flex-col gap-2">
          <legend className="mb-1 text-xs text-bodor-muted">Formato</legend>
          {(Object.keys(FORMAT_INFO) as SaveFormat[]).map((f) => (
            <label
              key={f}
              className={`flex cursor-pointer items-start gap-2 rounded border px-3 py-2 text-xs transition-colors ${
                format === f
                  ? "border-bodor-accent bg-bodor-accent/10"
                  : "border-bodor-line hover:border-bodor-accent/50"
              }`}
            >
              <input
                type="radio"
                name="format"
                value={f}
                checked={format === f}
                onChange={() => setFormat(f)}
                className="mt-0.5 accent-[#ff6b1a]"
              />
              <span className="flex-1">
                <span className="block font-semibold text-bodor-text">
                  {FORMAT_INFO[f].label}
                </span>
                <span className="block text-[11px] text-bodor-muted">
                  {FORMAT_INFO[f].desc}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {error && (
          <div className="mb-3 rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-300">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-10 rounded border border-bodor-line px-4 text-sm hover:border-bodor-accent/50 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !filename.trim()}
            className="h-10 rounded bg-bodor-accent px-4 text-sm font-semibold text-bodor-bg hover:bg-bodor-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

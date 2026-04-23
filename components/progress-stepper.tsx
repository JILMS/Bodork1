"use client";
import { useEffect, useState } from "react";

export type StepId =
  | "compress"
  | "analyze"
  | "engine"
  | "build"
  | "step";

export type StepState = "pending" | "active" | "done" | "error";

export type StepProgress = {
  loaded: number;
  total: number;
  unit?: "bytes";
};

export type StepInfo = {
  id: StepId;
  label: string;
  state: StepState;
  // Milliseconds it actually took (only when done).
  elapsedMs?: number;
  // Lower/upper expected duration in seconds, rendered as "~2–6 s".
  estimateRangeSec?: [number, number];
  // Extra sub-info, e.g. "Pieza 2 de 3".
  note?: string;
  // Optional byte-level progress bar (shown while active).
  progress?: StepProgress;
  // Error message if state === "error".
  error?: string;
};

function useElapsed(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  const [start, setStart] = useState<number | null>(active ? Date.now() : null);

  useEffect(() => {
    if (!active) {
      setStart(null);
      return;
    }
    setStart(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [active]);

  return start ? now - start : 0;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  return `${Math.round(s)} s`;
}

function formatMB(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Icon({ state }: { state: StepState }) {
  const common =
    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold";
  if (state === "done")
    return (
      <span className={`${common} bg-emerald-500 text-bodor-bg`} aria-hidden>
        ✓
      </span>
    );
  if (state === "error")
    return (
      <span className={`${common} bg-red-500 text-bodor-bg`} aria-hidden>
        !
      </span>
    );
  if (state === "active")
    return (
      <span
        className={`${common} border-2 border-bodor-accent border-t-transparent bg-transparent animate-spin`}
        aria-hidden
      />
    );
  return (
    <span
      className={`${common} border border-bodor-line bg-bodor-panel text-bodor-muted`}
      aria-hidden
    >
      •
    </span>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bodor-line/60">
      <div
        className="h-full rounded-full bg-bodor-accent transition-[width] duration-150 ease-out"
        style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}

function StepRow({ step }: { step: StepInfo }) {
  const elapsed = useElapsed(step.state === "active");
  const rangeText = step.estimateRangeSec
    ? `~${step.estimateRangeSec[0]}–${step.estimateRangeSec[1]} s`
    : null;

  const pct =
    step.progress && step.progress.total > 0
      ? (step.progress.loaded / step.progress.total) * 100
      : null;

  return (
    <li
      className={`rounded-md border px-3 py-2 text-xs transition-colors ${
        step.state === "active"
          ? "border-bodor-accent/60 bg-bodor-accent/5"
          : step.state === "done"
            ? "border-emerald-500/30 bg-emerald-500/5"
            : step.state === "error"
              ? "border-red-500/40 bg-red-500/5"
              : "border-bodor-line bg-bodor-panel"
      }`}
    >
      <div className="flex items-center gap-3">
        <Icon state={step.state} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={`truncate font-medium ${
                step.state === "pending"
                  ? "text-bodor-muted"
                  : "text-bodor-text"
              }`}
            >
              {step.label}
            </span>
            <span className="shrink-0 tabular-nums text-[10px] text-bodor-muted">
              {step.state === "active" &&
                (pct !== null ? `${Math.round(pct)} %` : formatMs(elapsed))}
              {step.state === "done" &&
                step.elapsedMs !== undefined &&
                formatMs(step.elapsedMs)}
              {step.state === "pending" && rangeText}
            </span>
          </div>
          {step.note && (
            <div className="truncate text-[10px] text-bodor-muted">
              {step.note}
            </div>
          )}
          {step.state === "error" && step.error && (
            <div className="whitespace-pre-wrap break-words text-[10px] text-red-300">
              {step.error}
            </div>
          )}
        </div>
      </div>

      {step.state === "active" && pct !== null && step.progress && (
        <>
          <ProgressBar pct={pct} />
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-bodor-muted">
            <span>
              {formatMB(step.progress.loaded)} / {formatMB(step.progress.total)}
            </span>
            <span>
              {formatMs(elapsed)} · {step.progress.loaded > 0 && elapsed > 200
                ? `${formatMB((step.progress.loaded / elapsed) * 1000)}/s`
                : "…"}
            </span>
          </div>
        </>
      )}
    </li>
  );
}

export function ProgressStepper({ steps }: { steps: StepInfo[] }) {
  return (
    <ol className="flex flex-col gap-1.5" aria-label="Progreso">
      {steps.map((step) => (
        <StepRow key={step.id} step={step} />
      ))}
    </ol>
  );
}

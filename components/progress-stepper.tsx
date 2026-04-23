"use client";
import { useEffect, useState } from "react";

export type StepId =
  | "compress"
  | "analyze"
  | "engine"
  | "build"
  | "step";

export type StepState = "pending" | "active" | "done" | "error";

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

function Icon({ state }: { state: StepState }) {
  const common = "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold";
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

function StepRow({ step }: { step: StepInfo }) {
  const elapsed = useElapsed(step.state === "active");
  const rangeText = step.estimateRangeSec
    ? `~${step.estimateRangeSec[0]}–${step.estimateRangeSec[1]} s`
    : null;

  return (
    <li
      className={`flex items-center gap-3 rounded-md border px-3 py-2 text-xs transition-colors ${
        step.state === "active"
          ? "border-bodor-accent/60 bg-bodor-accent/5"
          : step.state === "done"
            ? "border-emerald-500/30 bg-emerald-500/5"
            : step.state === "error"
              ? "border-red-500/40 bg-red-500/5"
              : "border-bodor-line bg-bodor-panel"
      }`}
    >
      <Icon state={step.state} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate font-medium ${
              step.state === "pending" ? "text-bodor-muted" : "text-bodor-text"
            }`}
          >
            {step.label}
          </span>
          <span className="shrink-0 tabular-nums text-[10px] text-bodor-muted">
            {step.state === "active" && formatMs(elapsed)}
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

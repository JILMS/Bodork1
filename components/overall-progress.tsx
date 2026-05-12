"use client";
import type { StepInfo } from "./progress-stepper";

type Props = {
  steps: StepInfo[];
  // Overall ready / working / error label for the center text.
  centerLabel?: string;
};

// Weighted overall percentage. Each step contributes a slice; when the
// step is "done" the slice is full, when "active" we estimate from the
// step's own progress (bytes for engine, otherwise half), pending = 0.
function overallPercent(steps: StepInfo[]): number {
  if (!steps.length) return 0;
  // Weight engine heaviest (longest), analyze next, then build / step.
  const weights: Record<string, number> = {
    compress: 5,
    analyze: 35,
    engine: 30,
    build: 20,
    step: 10,
  };
  let total = 0;
  let done = 0;
  for (const s of steps) {
    const w = weights[s.id] ?? 10;
    total += w;
    if (s.state === "done") done += w;
    else if (s.state === "active") {
      let frac = 0.5;
      if (s.progress && s.progress.total > 0) {
        frac = Math.min(1, s.progress.loaded / s.progress.total);
      }
      done += w * frac;
    }
  }
  return total > 0 ? (done / total) * 100 : 0;
}

export function OverallProgress({ steps, centerLabel }: Props) {
  const pct = overallPercent(steps);
  const size = 96;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);

  const active = steps.find((s) => s.state === "active");
  const errored = steps.some((s) => s.state === "error");
  const allDone = steps.every((s) => s.state === "done");

  let trackColor = "#27313f";
  let progressColor = "#ff7a2c";
  if (errored) progressColor = "#f87171";
  else if (allDone) progressColor = "#34d399";

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={trackColor}
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={progressColor}
            strokeWidth={stroke}
            strokeDasharray={c}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 200ms ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base font-bold tabular-nums leading-none text-bodor-text">
            {Math.round(pct)}%
          </span>
          {centerLabel && (
            <span className="mt-0.5 text-[8px] uppercase tracking-wider text-bodor-muted">
              {centerLabel}
            </span>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        {errored ? (
          <div className="text-xs font-semibold text-bodor-bad">Error</div>
        ) : allDone ? (
          <div className="text-xs font-semibold text-bodor-good">
            Pieza preparada
          </div>
        ) : active ? (
          <>
            <div className="truncate text-xs font-semibold text-bodor-text">
              {active.label}
            </div>
            {active.note && (
              <div className="truncate text-[10px] text-bodor-muted">
                {active.note}
              </div>
            )}
          </>
        ) : (
          <div className="text-xs text-bodor-muted">Esperando archivo…</div>
        )}
        <div className="mt-1 text-[10px] text-bodor-muted">
          {steps.filter((s) => s.state === "done").length} / {steps.length} pasos
        </div>
      </div>
    </div>
  );
}

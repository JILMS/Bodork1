"use client";
import { useMemo, useState } from "react";

export type PerforatedTubeArgs = {
  outer_diameter_mm: number;
  wall_thickness_mm: number;
  length_mm: number;
  hole_diameter_mm: number;
  edge_gap_mm: number;
  end_margin_mm: number;
};

type Props = {
  onGenerate: (args: PerforatedTubeArgs) => void;
  disabled: boolean;
};

export function PerforatedTubeCard({ onGenerate, disabled }: Props) {
  const [args, setArgs] = useState<PerforatedTubeArgs>({
    outer_diameter_mm: 30,
    wall_thickness_mm: 1.5,
    length_mm: 500,
    hole_diameter_mm: 3,
    edge_gap_mm: 3,
    end_margin_mm: 0,
  });

  const preview = useMemo(() => {
    const pitch = args.hole_diameter_mm + args.edge_gap_mm;
    const circumference = Math.PI * args.outer_diameter_mm;
    const nCirc = Math.max(1, Math.round(circumference / pitch));
    const rowSpacing = pitch * (Math.sqrt(3) / 2);
    const usable = Math.max(
      0,
      args.length_mm - 2 * args.end_margin_mm - args.hole_diameter_mm,
    );
    const nRows = usable > 0 ? Math.floor(usable / rowSpacing) + 1 : 0;
    return {
      nCirc,
      nRows,
      total: nCirc * nRows,
      arcPitch: circumference / nCirc,
      rowSpacing,
      sheetWidth: circumference,
    };
  }, [args]);

  const set = <K extends keyof PerforatedTubeArgs>(
    key: K,
    v: number,
  ) => setArgs((s) => ({ ...s, [key]: v }));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-bodor-muted">
        Genera la <strong>chapa desarrollada</strong> del tubo
        (rectángulo plano) con el patrón hexagonal de agujeros. El K1
        corta el rectángulo; el operario la enrolla y suelda el
        canto para formar el tubo. Sin IA, sin consumir saldo.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Ø exterior (mm)"
          value={args.outer_diameter_mm}
          onChange={(v) => set("outer_diameter_mm", v)}
        />
        <Field
          label="Espesor pared (mm)"
          value={args.wall_thickness_mm}
          onChange={(v) => set("wall_thickness_mm", v)}
          step={0.1}
        />
        <Field
          label="Longitud (mm)"
          value={args.length_mm}
          onChange={(v) => set("length_mm", v)}
          step={10}
        />
        <Field
          label="Margen extremos (mm)"
          value={args.end_margin_mm}
          onChange={(v) => set("end_margin_mm", v)}
        />
        <Field
          label="Ø agujero (mm)"
          value={args.hole_diameter_mm}
          onChange={(v) => set("hole_diameter_mm", v)}
          step={0.5}
        />
        <Field
          label="Separación entre bordes (mm)"
          value={args.edge_gap_mm}
          onChange={(v) => set("edge_gap_mm", v)}
          step={0.5}
        />
      </div>

      <div className="rounded-lg border border-bodor-line bg-bodor-panel/40 p-3 text-[11px] text-bodor-text">
        <div>
          Chapa <strong>{args.length_mm} × {preview.sheetWidth.toFixed(1)} mm</strong>
          {" "}(largo × desarrollo)
        </div>
        <div>
          <strong>{preview.total.toLocaleString("es-ES")}</strong> agujeros
          totales
        </div>
        <div className="text-bodor-muted">
          {preview.nCirc} por vuelta · {preview.nRows} filas · paso
          circular {preview.arcPitch.toFixed(2)} mm · distancia entre
          filas {preview.rowSpacing.toFixed(2)} mm
        </div>
      </div>

      <button
        type="button"
        onClick={() => onGenerate(args)}
        disabled={disabled}
        className="h-12 rounded-lg bg-gradient-to-br from-bodor-accent to-orange-600 px-4 text-sm font-bold uppercase tracking-wider text-bodor-bg shadow-md transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Generar chapa perforada
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px]">
      <span className="text-bodor-muted">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          onChange(Number.isFinite(v) ? v : 0);
        }}
        className="h-10 rounded border border-bodor-line bg-bodor-panel px-2 text-sm"
      />
    </label>
  );
}

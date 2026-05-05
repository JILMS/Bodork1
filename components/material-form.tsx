"use client";
import { useState } from "react";
import type { Material } from "@/lib/part-spec";

export type ProfileKindHint =
  | "auto"
  | "flat_bar"
  | "round_tube"
  | "square_tube"
  | "rectangular_tube"
  | "angle_profile";

export type Hints = {
  default_material: Material;
  default_thickness_mm: number;
  force_profile_kind: ProfileKindHint;
  force_corner_radius_mm: number;
};

type Props = {
  value: Hints;
  onChange: (v: Hints) => void;
};

const PROFILE_OPTIONS: Array<{ value: ProfileKindHint; label: string }> = [
  { value: "auto", label: "Detectar del plano" },
  { value: "flat_bar", label: "Pletina (plana)" },
  { value: "round_tube", label: "Tubo redondo" },
  { value: "square_tube", label: "Tubo cuadrado" },
  { value: "rectangular_tube", label: "Tubo rectangular" },
  { value: "angle_profile", label: "Perfil en L" },
];

const isTube = (k: ProfileKindHint) =>
  k === "round_tube" || k === "square_tube" || k === "rectangular_tube";

export function MaterialForm({ value, onChange }: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedDirty =
    value.force_profile_kind !== "auto" || value.force_corner_radius_mm > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-bodor-muted">Material (si no aparece en el plano)</span>
          <select
            value={value.default_material}
            onChange={(e) =>
              onChange({
                ...value,
                default_material: e.target.value as Material,
              })
            }
            className="h-10 rounded border border-bodor-line bg-bodor-panel px-2 text-sm"
          >
            <option value="hierro">Hierro</option>
            <option value="acero_carbono">Acero carbono</option>
            <option value="acero_inox">Acero inox</option>
            <option value="aluminio">Aluminio</option>
            <option value="galvanizado">Galvanizado</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-bodor-muted">Espesor (si no aparece en el plano)</span>
          <input
            type="number"
            inputMode="decimal"
            min={0.5}
            step={0.5}
            value={value.default_thickness_mm}
            onChange={(e) =>
              onChange({
                ...value,
                default_thickness_mm: parseFloat(e.target.value) || 0,
              })
            }
            className="h-10 rounded border border-bodor-line bg-bodor-panel px-2 text-sm"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={() => setAdvancedOpen((o) => !o)}
        className="self-start text-[11px] text-bodor-muted underline-offset-2 hover:text-bodor-text hover:underline"
      >
        {advancedOpen ? "▴ Ocultar avanzado" : "▾ Avanzado"}
        {advancedDirty && !advancedOpen && (
          <span className="ml-1 rounded-full bg-bodor-accent/30 px-1.5 text-[10px] text-bodor-accent">
            activo
          </span>
        )}
      </button>

      {advancedOpen && (
        <div className="flex flex-col gap-3 rounded border border-bodor-line bg-bodor-panel/40 p-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-bodor-muted">Tipo de perfil (forzar)</span>
            <select
              value={value.force_profile_kind}
              onChange={(e) =>
                onChange({
                  ...value,
                  force_profile_kind: e.target.value as ProfileKindHint,
                })
              }
              className="h-10 rounded border border-bodor-line bg-bodor-panel px-2 text-sm"
            >
              {PROFILE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-bodor-muted">
              Forzar = la IA usará este tipo aunque el plano sugiera otro.
            </span>
          </label>

          {isTube(value.force_profile_kind) && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-bodor-muted">
                Radio de esquina del tubo (mm)
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.5}
                value={value.force_corner_radius_mm}
                onChange={(e) =>
                  onChange({
                    ...value,
                    force_corner_radius_mm: parseFloat(e.target.value) || 0,
                  })
                }
                className="h-10 rounded border border-bodor-line bg-bodor-panel px-2 text-sm"
              />
              <span className="text-[10px] text-bodor-muted">
                Sólo afecta tubos cuadrados / rectangulares. 0 = esquinas
                vivas.
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

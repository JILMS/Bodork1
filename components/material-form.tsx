"use client";
import type { Material } from "@/lib/part-spec";

export type Hints = {
  default_material: Material;
  default_thickness_mm: number;
};

type Props = {
  value: Hints;
  onChange: (v: Hints) => void;
};

export function MaterialForm({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-bodor-muted">Material</span>
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
          <option value="acero_carbono">Acero carbono</option>
          <option value="acero_inox">Acero inox</option>
          <option value="aluminio">Aluminio</option>
          <option value="galvanizado">Galvanizado</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-bodor-muted">Espesor por defecto (mm)</span>
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
  );
}

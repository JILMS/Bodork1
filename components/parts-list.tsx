"use client";
import type { Drawing, PartSpec } from "@/lib/part-spec";

type Props = {
  drawing: Drawing;
  selected: number;
  onSelect: (i: number) => void;
};

export function PartsList({ drawing, selected, onSelect }: Props) {
  return (
    <div
      className="flex flex-col divide-y divide-bodor-line overflow-hidden rounded border border-bodor-line"
      role="listbox"
      aria-label="Piezas detectadas"
    >
      {drawing.parts.map((p, i) => (
        <button
          key={i}
          type="button"
          role="option"
          aria-selected={selected === i}
          onClick={() => onSelect(i)}
          className={`flex min-h-[64px] flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors ${
            selected === i
              ? "bg-bodor-accent/10 text-bodor-text"
              : "hover:bg-bodor-panel active:bg-bodor-panel"
          }`}
        >
          <span className="text-xs font-semibold">{displayName(p, i)}</span>
          <span className="text-[11px] text-bodor-muted">
            {describeProfile(p)}
          </span>
          <span className="text-[11px] text-bodor-muted">
            {p.quantity} uds · {p.material.replace("_", " ")}
          </span>
        </button>
      ))}
    </div>
  );
}

function displayName(p: PartSpec, i: number) {
  return p.name ?? `Pieza ${i + 1}`;
}

function describeProfile(p: PartSpec): string {
  const pr = p.profile;
  switch (pr.kind) {
    case "flat_bar":
      return `Pletina ${pr.width_mm}×${pr.thickness_mm} × ${pr.length_mm} mm · ${pr.holes.length} agujeros`;
    case "round_tube":
      return `Tubo Ø${pr.outer_diameter_mm}×${pr.wall_thickness_mm} × ${pr.length_mm} mm`;
    case "square_tube":
      return `Tubo □${pr.side_mm}×${pr.wall_thickness_mm}${pr.corner_radius_mm ? ` (R${pr.corner_radius_mm})` : ""} × ${pr.length_mm} mm`;
    case "rectangular_tube":
      return `Tubo ▭${pr.width_mm}×${pr.height_mm}×${pr.wall_thickness_mm}${pr.corner_radius_mm ? ` (R${pr.corner_radius_mm})` : ""} × ${pr.length_mm} mm`;
    case "angle_profile":
      return `Perfil L ${pr.leg_a_mm}×${pr.leg_b_mm}×${pr.thickness_mm} × ${pr.length_mm} mm`;
  }
}

"use client";
import type { Drawing, PartSpec } from "@/lib/part-spec";

type Props = {
  drawing: Drawing;
  selected: number;
  onSelect: (i: number) => void;
};

export function PartsList({ drawing, selected, onSelect }: Props) {
  return (
    <div className="flex flex-col divide-y divide-bodor-line rounded border border-bodor-line">
      {drawing.parts.map((p, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(i)}
          className={`flex flex-col gap-0.5 px-3 py-2 text-left text-xs transition-colors ${
            selected === i
              ? "bg-bodor-accent/10 text-bodor-text"
              : "hover:bg-bodor-panel"
          }`}
        >
          <span className="font-semibold">{displayName(p, i)}</span>
          <span className="text-bodor-muted">{describeProfile(p)}</span>
          <span className="text-bodor-muted">
            {p.quantity} uds · {p.material}
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
      return `Tubo □${pr.side_mm}×${pr.wall_thickness_mm} × ${pr.length_mm} mm`;
    case "angle_profile":
      return `Perfil L ${pr.leg_a_mm}×${pr.leg_b_mm}×${pr.thickness_mm} × ${pr.length_mm} mm`;
  }
}

"use client";
import { useMemo } from "react";
import type {
  Cutout,
  Drawing,
  Hole,
  MissingField,
  PartSpec,
  Slot,
} from "@/lib/part-spec";

type Props = {
  drawing: Drawing;
  onChange: (d: Drawing) => void;
  onBuild: () => void;
  canBuild: boolean;
  isBuilding: boolean;
};

function readPath(obj: unknown, path: string): unknown {
  const tokens = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur: unknown = obj;
  for (const t of tokens) {
    if (cur && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[t];
    } else {
      return undefined;
    }
  }
  return cur;
}

function writePath<T>(obj: T, path: string, value: unknown): T {
  const tokens = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  const clone: T = Array.isArray(obj)
    ? ([...obj] as unknown as T)
    : ({ ...(obj as Record<string, unknown>) } as T);
  let cur: Record<string, unknown> | unknown[] = clone as unknown as
    | Record<string, unknown>
    | unknown[];
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    const next = (cur as Record<string, unknown>)[t];
    const copied = Array.isArray(next)
      ? [...(next as unknown[])]
      : { ...((next as Record<string, unknown>) ?? {}) };
    (cur as Record<string, unknown>)[t] = copied;
    cur = copied;
  }
  (cur as Record<string, unknown>)[tokens[tokens.length - 1]] = value;
  return clone;
}

function fieldsForPart(p: PartSpec): Array<{
  path: string;
  label: string;
  unit: string;
}> {
  const out: Array<{ path: string; label: string; unit: string }> = [];
  const pr = p.profile;
  switch (pr.kind) {
    case "flat_bar":
      out.push(
        { path: "profile.length_mm", label: "Longitud", unit: "mm" },
        { path: "profile.width_mm", label: "Ancho", unit: "mm" },
        { path: "profile.thickness_mm", label: "Espesor", unit: "mm" },
      );
      break;
    case "round_tube":
      out.push(
        { path: "profile.length_mm", label: "Longitud", unit: "mm" },
        { path: "profile.outer_diameter_mm", label: "Ø exterior", unit: "mm" },
        {
          path: "profile.wall_thickness_mm",
          label: "Espesor pared",
          unit: "mm",
        },
      );
      break;
    case "square_tube":
      out.push(
        { path: "profile.length_mm", label: "Longitud", unit: "mm" },
        { path: "profile.side_mm", label: "Lado", unit: "mm" },
        {
          path: "profile.wall_thickness_mm",
          label: "Espesor pared",
          unit: "mm",
        },
        {
          path: "profile.corner_radius_mm",
          label: "Radio esquina",
          unit: "mm",
        },
      );
      break;
    case "rectangular_tube":
      out.push(
        { path: "profile.length_mm", label: "Longitud", unit: "mm" },
        { path: "profile.width_mm", label: "Ancho", unit: "mm" },
        { path: "profile.height_mm", label: "Alto", unit: "mm" },
        {
          path: "profile.wall_thickness_mm",
          label: "Espesor pared",
          unit: "mm",
        },
        {
          path: "profile.corner_radius_mm",
          label: "Radio esquina",
          unit: "mm",
        },
      );
      break;
    case "angle_profile":
      out.push(
        { path: "profile.length_mm", label: "Longitud", unit: "mm" },
        { path: "profile.leg_a_mm", label: "Ala A", unit: "mm" },
        { path: "profile.leg_b_mm", label: "Ala B", unit: "mm" },
        { path: "profile.thickness_mm", label: "Espesor", unit: "mm" },
      );
      break;
  }
  return out;
}

function partHasLegs(p: PartSpec): boolean {
  return p.profile.kind === "angle_profile";
}

function defaultEdgeOffset(p: PartSpec): number {
  const pr = p.profile;
  if (pr.kind === "flat_bar") return pr.width_mm / 2;
  if (pr.kind === "angle_profile") return pr.leg_a_mm / 2;
  return 0;
}

export function PartEditor({
  drawing,
  onChange,
  onBuild,
  canBuild,
  isBuilding,
}: Props) {
  const missingByPart = useMemo(() => {
    const m = new Map<number, MissingField[]>();
    for (const mf of drawing.missing_fields) {
      const arr = m.get(mf.part_index) ?? [];
      arr.push(mf);
      m.set(mf.part_index, arr);
    }
    return m;
  }, [drawing.missing_fields]);

  const totalMissing = drawing.missing_fields.length;

  const updatePart = (i: number, patch: PartSpec) => {
    onChange({
      ...drawing,
      parts: drawing.parts.map((pp, idx) => (idx === i ? patch : pp)),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`rounded-md border px-3 py-2 text-[11px] ${
          totalMissing > 0
            ? "border-amber-400/50 bg-amber-400/10 text-amber-200"
            : "border-emerald-500/40 bg-emerald-500/5 text-emerald-300"
        }`}
      >
        {totalMissing > 0 ? (
          <>
            <strong>Revisa {totalMissing} dato{totalMissing === 1 ? "" : "s"}:</strong>{" "}
            la IA no los ha leído con seguridad. Confirma o corrige los
            valores en ámbar y después pulsa <em>Construir 3D</em>.
          </>
        ) : (
          <>
            <strong>Todo claro.</strong> Revisa cotas y agujeros, añade los
            que falten, y pulsa <em>Construir 3D</em>.
          </>
        )}
      </div>

      {drawing.parts.map((p, i) => {
        const missing = missingByPart.get(i) ?? [];
        const missingPaths = new Set(missing.map((m) => m.field_path));
        const fields = fieldsForPart(p);
        const showLeg = partHasLegs(p);
        return (
          <details
            key={i}
            open
            className="rounded-md border border-bodor-line bg-bodor-panel/60"
          >
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold">
              {p.name ?? `Pieza ${i + 1}`}{" "}
              <span className="text-bodor-muted">· {p.quantity} uds</span>
              {missing.length > 0 && (
                <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                  {missing.length} dato{missing.length === 1 ? "" : "s"} a
                  revisar
                </span>
              )}
            </summary>

            <div className="flex flex-col gap-3 px-3 pb-3 pt-1">
              {/* Top-level dimensions */}
              <div className="grid grid-cols-2 gap-2">
                {fields.map((f) => {
                  const current = readPath(p, f.path);
                  const isMissing = missingPaths.has(f.path);
                  const mf = missing.find((m) => m.field_path === f.path);
                  return (
                    <label
                      key={f.path}
                      className="flex flex-col gap-1 text-[11px]"
                    >
                      <span
                        className={
                          isMissing ? "text-amber-300" : "text-bodor-muted"
                        }
                      >
                        {f.label} ({f.unit}){isMissing && " ⚠"}
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        value={
                          typeof current === "number"
                            ? current
                            : current === undefined
                              ? ""
                              : String(current)
                        }
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          const next = Number.isFinite(v) ? v : 0;
                          const newPart = writePath(p, f.path, next);
                          onChange({
                            ...drawing,
                            parts: drawing.parts.map((pp, idx) =>
                              idx === i ? newPart : pp,
                            ),
                            missing_fields: drawing.missing_fields.filter(
                              (m) =>
                                !(m.part_index === i && m.field_path === f.path),
                            ),
                          });
                        }}
                        className={`h-9 rounded border px-2 text-sm ${
                          isMissing
                            ? "border-amber-400/70 bg-amber-400/5"
                            : "border-bodor-line bg-bodor-panel"
                        }`}
                      />
                      {isMissing && mf?.reason && (
                        <span className="text-[10px] text-amber-300/80">
                          {mf.reason}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              {/* Holes */}
              {(p.profile.kind === "flat_bar" ||
                p.profile.kind === "angle_profile" ||
                p.profile.kind === "round_tube" ||
                p.profile.kind === "square_tube" ||
                p.profile.kind === "rectangular_tube") && (
                <FeatureSection
                  title="Agujeros redondos"
                  color="border-red-500/40 bg-red-500/5"
                  count={p.profile.holes.length}
                  onAdd={() => {
                    const newHole: Hole & { leg?: "a" | "b"; face?: 1 | 2 | 3 | 4; face_angle_deg?: number } = {
                      diameter_mm: 10,
                      position_mm: 50,
                      edge_offset_mm: defaultEdgeOffset(p),
                      type: "through",
                    };
                    if (p.profile.kind === "angle_profile") newHole.leg = "a";
                    if (p.profile.kind === "square_tube" || p.profile.kind === "rectangular_tube") newHole.face = 1;
                    if (p.profile.kind === "round_tube") newHole.face_angle_deg = 0;
                    const next = writePath(p, "profile.holes", [
                      ...p.profile.holes,
                      newHole,
                    ]);
                    updatePart(i, next as PartSpec);
                  }}
                >
                  {p.profile.holes.map((h, hi) => (
                    <HoleRow
                      key={hi}
                      h={h}
                      idx={hi}
                      showLeg={showLeg}
                      onChange={(patch) => {
                        const newHoles = p.profile.holes.map((x, xi) =>
                          xi === hi ? { ...x, ...patch } : x,
                        );
                        updatePart(i, writePath(p, "profile.holes", newHoles) as PartSpec);
                      }}
                      onDelete={() => {
                        const newHoles = p.profile.holes.filter(
                          (_, xi) => xi !== hi,
                        );
                        updatePart(i, writePath(p, "profile.holes", newHoles) as PartSpec);
                      }}
                    />
                  ))}
                </FeatureSection>
              )}

              {/* Slots */}
              {(p.profile.kind === "flat_bar" ||
                p.profile.kind === "angle_profile") &&
                (() => {
                  const profile = p.profile;
                  return (
                    <FeatureSection
                      title="Slots / agujeros oblongos"
                      color="border-orange-500/40 bg-orange-500/5"
                      count={profile.slots.length}
                      onAdd={() => {
                        const newSlot: Slot & { leg?: "a" | "b" } = {
                          length_mm: 30,
                          width_mm: 12,
                          position_mm: 50,
                          edge_offset_mm: defaultEdgeOffset(p),
                          rotation_deg: 0,
                        };
                        if (profile.kind === "angle_profile")
                          newSlot.leg = "a";
                        const next = writePath(p, "profile.slots", [
                          ...profile.slots,
                          newSlot,
                        ]);
                        updatePart(i, next as PartSpec);
                      }}
                    >
                      {profile.slots.map((s, si) => (
                        <SlotRow
                          key={si}
                          s={s}
                          idx={si}
                          kind="slot"
                          showLeg={showLeg}
                          onChange={(patch) => {
                            const newSlots = profile.slots.map((x, xi) =>
                              xi === si ? { ...x, ...patch } : x,
                            );
                            updatePart(
                              i,
                              writePath(p, "profile.slots", newSlots) as PartSpec,
                            );
                          }}
                          onDelete={() => {
                            const newSlots = profile.slots.filter(
                              (_, xi) => xi !== si,
                            );
                            updatePart(
                              i,
                              writePath(p, "profile.slots", newSlots) as PartSpec,
                            );
                          }}
                        />
                      ))}
                    </FeatureSection>
                  );
                })()}

              {/* Cutouts */}
              {(p.profile.kind === "flat_bar" ||
                p.profile.kind === "angle_profile") &&
                (() => {
                  const profile = p.profile;
                  return (
                    <FeatureSection
                      title="Recortes rectangulares"
                      color="border-violet-500/40 bg-violet-500/5"
                      count={profile.cutouts.length}
                      onAdd={() => {
                        const newCutout: Cutout & { leg?: "a" | "b" } = {
                          length_mm: 30,
                          width_mm: 20,
                          position_mm: 50,
                          edge_offset_mm: defaultEdgeOffset(p),
                          rotation_deg: 0,
                        };
                        if (profile.kind === "angle_profile")
                          newCutout.leg = "a";
                        const next = writePath(p, "profile.cutouts", [
                          ...profile.cutouts,
                          newCutout,
                        ]);
                        updatePart(i, next as PartSpec);
                      }}
                    >
                      {profile.cutouts.map((c, ci) => (
                        <SlotRow
                          key={ci}
                          s={c}
                          idx={ci}
                          kind="cutout"
                          showLeg={showLeg}
                          onChange={(patch) => {
                            const newCutouts = profile.cutouts.map((x, xi) =>
                              xi === ci ? { ...x, ...patch } : x,
                            );
                            updatePart(
                              i,
                              writePath(p, "profile.cutouts", newCutouts) as PartSpec,
                            );
                          }}
                          onDelete={() => {
                            const newCutouts = profile.cutouts.filter(
                              (_, xi) => xi !== ci,
                            );
                            updatePart(
                              i,
                              writePath(p, "profile.cutouts", newCutouts) as PartSpec,
                            );
                          }}
                        />
                      ))}
                    </FeatureSection>
                  );
                })()}
            </div>
          </details>
        );
      })}

      <button
        type="button"
        onClick={onBuild}
        disabled={!canBuild || isBuilding}
        className="h-11 rounded bg-bodor-accent px-4 text-sm font-semibold text-bodor-bg transition-colors hover:bg-bodor-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isBuilding ? "Construyendo…" : "Construir 3D"}
      </button>
    </div>
  );
}

function FeatureSection({
  title,
  color,
  count,
  onAdd,
  children,
}: {
  title: string;
  color: string;
  count: number;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 rounded border ${color} p-2`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-bodor-text">
          {title}{" "}
          <span className="text-bodor-muted">({count})</span>
        </span>
        <button
          type="button"
          onClick={onAdd}
          className="rounded border border-bodor-line bg-bodor-bg px-2 py-0.5 text-[11px] hover:border-bodor-accent/60"
        >
          + Añadir
        </button>
      </div>
      {count > 0 && <div className="flex flex-col gap-1">{children}</div>}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  step = 0.5,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      value={value === undefined ? "" : value}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        onChange(Number.isFinite(v) ? v : 0);
      }}
      className="h-7 w-full rounded border border-bodor-line bg-bodor-panel px-1.5 text-[11px]"
    />
  );
}

function LegSelect({
  value,
  onChange,
}: {
  value: "a" | "b";
  onChange: (v: "a" | "b") => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as "a" | "b")}
      className="h-7 rounded border border-bodor-line bg-bodor-panel px-1 text-[11px]"
    >
      <option value="a">ala A</option>
      <option value="b">ala B</option>
    </select>
  );
}

function HoleRow({
  h,
  idx,
  showLeg,
  onChange,
  onDelete,
}: {
  h: Hole & { leg?: "a" | "b" };
  idx: number;
  showLeg: boolean;
  onChange: (patch: Partial<Hole & { leg?: "a" | "b" }>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="grid grid-cols-[24px_1fr_1fr_1fr_auto_24px] items-center gap-1 text-[11px]">
      <span className="text-bodor-muted">#{idx + 1}</span>
      <label className="flex items-center gap-1">
        <span className="text-bodor-muted">Ø</span>
        <NumInput value={h.diameter_mm} onChange={(v) => onChange({ diameter_mm: v })} />
      </label>
      <label className="flex items-center gap-1">
        <span className="text-bodor-muted">X</span>
        <NumInput value={h.position_mm} onChange={(v) => onChange({ position_mm: v })} />
      </label>
      <label className="flex items-center gap-1">
        <span className="text-bodor-muted">Y</span>
        <NumInput value={h.edge_offset_mm} onChange={(v) => onChange({ edge_offset_mm: v })} />
      </label>
      {showLeg && h.leg !== undefined ? (
        <LegSelect value={h.leg} onChange={(v) => onChange({ leg: v })} />
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={onDelete}
        title="Borrar"
        className="rounded text-red-300 hover:bg-red-500/10 hover:text-red-200"
      >
        ✕
      </button>
    </div>
  );
}

function SlotRow({
  s,
  idx,
  kind,
  showLeg,
  onChange,
  onDelete,
}: {
  s: (Slot | Cutout) & { leg?: "a" | "b" };
  idx: number;
  kind: "slot" | "cutout";
  showLeg: boolean;
  onChange: (
    patch: Partial<(Slot | Cutout) & { leg?: "a" | "b" }>,
  ) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 rounded border border-bodor-line/40 bg-bodor-panel/40 p-1.5 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="text-bodor-muted">
          {kind === "slot" ? "▣" : "▭"} #{idx + 1}
        </span>
        <button
          type="button"
          onClick={onDelete}
          title="Borrar"
          className="rounded px-1 text-red-300 hover:bg-red-500/10"
        >
          ✕
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <label className="flex items-center gap-1">
          <span className="text-bodor-muted">Largo</span>
          <NumInput
            value={s.length_mm}
            onChange={(v) => onChange({ length_mm: v })}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-bodor-muted">Ancho</span>
          <NumInput
            value={s.width_mm}
            onChange={(v) => onChange({ width_mm: v })}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-bodor-muted">X</span>
          <NumInput
            value={s.position_mm}
            onChange={(v) => onChange({ position_mm: v })}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-bodor-muted">Y</span>
          <NumInput
            value={s.edge_offset_mm}
            onChange={(v) => onChange({ edge_offset_mm: v })}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-bodor-muted">Giro°</span>
          <NumInput
            value={s.rotation_deg ?? 0}
            onChange={(v) => onChange({ rotation_deg: v })}
            step={5}
          />
        </label>
        {showLeg && s.leg !== undefined ? (
          <LegSelect
            value={s.leg}
            onChange={(v) => onChange({ leg: v })}
          />
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

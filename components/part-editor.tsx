"use client";
import { useMemo } from "react";
import type { Drawing, MissingField, PartSpec } from "@/lib/part-spec";

type Props = {
  drawing: Drawing;
  onChange: (d: Drawing) => void;
  onBuild: () => void;
  canBuild: boolean;
  isBuilding: boolean;
};

// Reads a numeric value from a dot/bracket path like
// "profile.length_mm" or "profile.holes[2].position_mm".
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

// Writes a value at the path, returning a new shallow-cloned tree so
// React treats the change as a state update.
function writePath<T>(obj: T, path: string, value: unknown): T {
  const tokens = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  const clone: T = Array.isArray(obj)
    ? ([...obj] as unknown as T)
    : { ...(obj as Record<string, unknown>) } as T;
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
            <strong>Todo claro.</strong> Revisa las cotas y pulsa{" "}
            <em>Construir 3D</em> cuando quieras ver el sólido.
          </>
        )}
      </div>

      {drawing.parts.map((p, i) => {
        const missing = missingByPart.get(i) ?? [];
        const missingPaths = new Set(missing.map((m) => m.field_path));
        const fields = fieldsForPart(p);
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

            <div className="grid grid-cols-2 gap-2 px-3 pb-3 pt-1">
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
                      {f.label} ({f.unit})
                      {isMissing && " ⚠"}
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
                        const newDrawing = {
                          ...drawing,
                          parts: drawing.parts.map((pp, idx) =>
                            idx === i ? newPart : pp,
                          ),
                          // Clearing this missing field once the user
                          // touched it: we assume they confirmed.
                          missing_fields: drawing.missing_fields.filter(
                            (m) =>
                              !(m.part_index === i && m.field_path === f.path),
                          ),
                        };
                        onChange(newDrawing);
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

              {p.profile.kind === "flat_bar" &&
                p.profile.holes.length > 0 && (
                  <div className="col-span-2 mt-1 flex flex-col gap-1">
                    <div className="text-[11px] text-bodor-muted">
                      Agujeros (posición desde extremo izquierdo)
                    </div>
                    {p.profile.holes.map((h, hi) => {
                      const path = `profile.holes[${hi}].position_mm`;
                      const dpath = `profile.holes[${hi}].diameter_mm`;
                      const isMissingPos = missingPaths.has(path);
                      const isMissingD = missingPaths.has(dpath);
                      return (
                        <div
                          key={hi}
                          className="grid grid-cols-[auto_1fr_1fr] items-center gap-2 text-[11px]"
                        >
                          <span className="text-bodor-muted">
                            #{hi + 1}
                          </span>
                          <label className="flex items-center gap-1">
                            <span className="text-bodor-muted">Ø</span>
                            <input
                              type="number"
                              step="0.5"
                              value={h.diameter_mm}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value) || 0;
                                const newPart = writePath(p, dpath, v);
                                onChange({
                                  ...drawing,
                                  parts: drawing.parts.map((pp, idx) =>
                                    idx === i ? newPart : pp,
                                  ),
                                  missing_fields: drawing.missing_fields.filter(
                                    (m) =>
                                      !(m.part_index === i && m.field_path === dpath),
                                  ),
                                });
                              }}
                              className={`h-8 w-full rounded border px-2 text-xs ${
                                isMissingD
                                  ? "border-amber-400/70 bg-amber-400/5"
                                  : "border-bodor-line bg-bodor-panel"
                              }`}
                            />
                          </label>
                          <label className="flex items-center gap-1">
                            <span className="text-bodor-muted">pos</span>
                            <input
                              type="number"
                              step="0.5"
                              value={h.position_mm}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value) || 0;
                                const newPart = writePath(p, path, v);
                                onChange({
                                  ...drawing,
                                  parts: drawing.parts.map((pp, idx) =>
                                    idx === i ? newPart : pp,
                                  ),
                                  missing_fields: drawing.missing_fields.filter(
                                    (m) =>
                                      !(m.part_index === i && m.field_path === path),
                                  ),
                                });
                              }}
                              className={`h-8 w-full rounded border px-2 text-xs ${
                                isMissingPos
                                  ? "border-amber-400/70 bg-amber-400/5"
                                  : "border-bodor-line bg-bodor-panel"
                              }`}
                            />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                )}

              {(p.profile.kind === "flat_bar" ||
                p.profile.kind === "angle_profile") &&
                (p.profile.slots.length > 0 || p.profile.cutouts.length > 0) && (
                  <div className="col-span-2 mt-2 flex flex-col gap-1 rounded border border-bodor-accent/30 bg-bodor-accent/5 p-2 text-[11px]">
                    <div className="font-semibold text-bodor-accent">
                      Slots y recortes detectados
                    </div>
                    {p.profile.slots.map((s, si) => (
                      <div key={`s${si}`} className="text-bodor-text">
                        ▣ Slot #{si + 1}: {s.length_mm}×{s.width_mm} mm @
                        {" "}X={s.position_mm}
                        {s.edge_offset_mm !== undefined
                          ? ` · Y=${s.edge_offset_mm}`
                          : ""}
                        {s.rotation_deg
                          ? ` · giro ${s.rotation_deg}°`
                          : ""}
                        {p.profile.kind === "angle_profile" && "leg" in s
                          ? ` · ala ${(s as { leg: string }).leg.toUpperCase()}`
                          : ""}
                      </div>
                    ))}
                    {p.profile.cutouts.map((c, ci) => (
                      <div key={`c${ci}`} className="text-bodor-text">
                        ▭ Recorte #{ci + 1}: {c.length_mm}×{c.width_mm} mm @
                        {" "}X={c.position_mm}
                        {c.edge_offset_mm !== undefined
                          ? ` · Y=${c.edge_offset_mm}`
                          : ""}
                        {c.rotation_deg
                          ? ` · giro ${c.rotation_deg}°`
                          : ""}
                        {p.profile.kind === "angle_profile" && "leg" in c
                          ? ` · ala ${(c as { leg: string }).leg.toUpperCase()}`
                          : ""}
                      </div>
                    ))}
                  </div>
                )}
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

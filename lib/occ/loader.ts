import type { OC } from "./types";

let cached: Promise<OC> | null = null;

// opencascade.js 2.x uses a custom-build loader: the main emscripten
// factory and each TK* library are shipped as separate .wasm assets
// whose URLs are produced by webpack (asset/resource). We pass the
// minimum subset our geometry + STEP-writer code touches so the browser
// downloads as little WASM as possible on first visit.
//
// Kept: B-Rep kernel, primitives, booleans, tessellation, STEP AP214 writer.
// Dropped (vs the default "all TK modules" bundle):
//   - TKShHealing, TKFillet, TKOffset — no healing / fillet / offset ops
//   - TKSTEP209 — we emit AP214 (write.step.schema = 3)
export function loadOC(): Promise<OC> {
  if (!cached) {
    cached = (async () => {
      const mod = await import("opencascade.js");
      const init = mod.initOpenCascade as (opts: {
        mainJS?: unknown;
        mainWasm?: string;
        libs?: string[];
      }) => Promise<OC>;
      return init({
        mainJS: mod.main,
        mainWasm: mod.mainWasm,
        libs: [
          mod.TKernel,
          mod.TKMath,
          mod.TKG2d,
          mod.TKG3d,
          mod.TKGeomBase,
          mod.TKBRep,
          mod.TKGeomAlgo,
          mod.TKTopAlgo,
          mod.TKPrim,
          mod.TKBO,
          mod.TKBool,
          mod.TKMesh,
          mod.TKXSBase,
          mod.TKSTEPBase,
          mod.TKSTEPAttr,
          mod.TKSTEP,
        ],
      });
    })();
  }
  return cached;
}

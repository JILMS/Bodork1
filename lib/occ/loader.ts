import type { OC } from "./types";

let cached: Promise<OC> | null = null;

// opencascade.js 2.x uses a custom-build loader: the main emscripten
// factory and each TK* library are shipped as separate .wasm assets whose
// URLs are produced by webpack (asset/resource). We pass the subset of
// libs our geometry code actually touches: B-Rep kernel, primitives,
// booleans, shape healing, meshing, and STEP I/O.
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
          mod.TKShHealing,
          mod.TKFillet,
          mod.TKOffset,
          mod.TKMesh,
          mod.TKXSBase,
          mod.TKSTEPBase,
          mod.TKSTEPAttr,
          mod.TKSTEP209,
          mod.TKSTEP,
        ],
      });
    })();
  }
  return cached;
}

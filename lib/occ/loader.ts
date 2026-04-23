import type { OC } from "./types";

let cached: Promise<OC> | null = null;

// opencascade.js 2.x ships pre-assembled "mega-bundles" meant to be
// passed to initOpenCascade via `libs`. Individual TK* modules exist
// only for custom builds and have fragile ordering/dependency issues
// when passed directly (e.g. TKernel isn't even an export — that bug
// is what kept the engine from ever booting).
//
// We load three bundles:
//   - ocCore (~17 MB raw / 3.8 MB gzip): kernel + geometry primitives.
//   - ocModelingAlgorithms (~34 MB / 6.7 MB gzip): BRep, Prim, Bool,
//     Mesh — everything our builders call.
//   - ocDataExchangeBase (~21 MB / 2.8 MB gzip): STEP reader + writer.
//
// We intentionally skip ocVisualApplication (three.js renders the mesh
// client-side) and ocDataExchangeExtra (no IGES / STL export).
export function loadOC(): Promise<OC> {
  if (!cached) {
    cached = (async () => {
      const mod = await import("opencascade.js");
      const init = mod.initOpenCascade as (opts: {
        libs?: string[];
      }) => Promise<OC>;
      return init({
        // README-recommended full bundle set. STEPControl_Writer lives
        // in the dataExchangeExtra bundle, which in turn depends on
        // CAF / LCAF symbols from visualApplication — without that
        // bundle the dynamic linker hangs. Total ~100 MB uncompressed,
        // ~20 MB gzip, cached forever on first load.
        libs: [
          mod.ocCore,
          mod.ocModelingAlgorithms,
          mod.ocVisualApplication,
          mod.ocDataExchangeBase,
          mod.ocDataExchangeExtra,
        ],
      });
    })();
  }
  return cached;
}

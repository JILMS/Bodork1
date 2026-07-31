/// <reference lib="webworker" />
import * as Comlink from "comlink";
import type { PartSpec } from "../part-spec";
import { loadOC } from "./loader";
import { buildPart } from "./build";
import { buildPerforatedTube as buildPerforatedTubeShape } from "./build-perforated-tube";
import { meshFromShape, type Mesh } from "./mesh-from-shape";
import { writeStep } from "./write-step";
import { writeStl } from "./write-stl";
import type { OC, ShapeHandle } from "./types";

export type WorkerProgress =
  | { kind: "loading_engine" }
  | { kind: "engine_progress"; loaded: number; total: number; files: number }
  | { kind: "engine_ready" }
  | { kind: "building_part"; partIndex: number; totalParts: number }
  | {
      kind: "batch_progress";
      partIndex: number;
      done: number;
      total: number;
    }
  | { kind: "tessellating"; partIndex: number };

export type BuildPartResponse = {
  mesh: Mesh;
  watertight: boolean;
};

export type ExportFormat = "step" | "stl";

export type ExportResult = {
  format: ExportFormat;
  // For STEP we return a string (ASCII). For STL we return a Uint8Array
  // (binary). Comlink transfers both transparently.
  content: string | Uint8Array;
  mime: string;
  extension: string;
  bytes: number;
};

export type ProgressCallback = (event: WorkerProgress) => void;

let engineLoaded = false;
let fetchPatched = false;
let activeProgressCallback: ProgressCallback | null = null;

const wasmBytes = new Map<string, { loaded: number; total: number }>();
// Cache of built shapes keyed by part index so the user can "Guardar
// archivo" later without rebuilding.
const shapeCache = new Map<number, ShapeHandle>();

function emitEngineProgress() {
  if (!activeProgressCallback) return;
  let loaded = 0;
  let total = 0;
  for (const v of wasmBytes.values()) {
    loaded += v.loaded;
    total += v.total;
  }
  activeProgressCallback({
    kind: "engine_progress",
    loaded,
    total,
    files: wasmBytes.size,
  });
}

function patchFetchForWasmProgress() {
  const originalFetch = self.fetch.bind(self);
  self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url: string;
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.toString();
    else url = input.url;

    const isWasm = /\.wasm(\?|$)/i.test(url);
    if (!isWasm) return originalFetch(input, init);

    const res = await originalFetch(input, init);
    if (!res.ok || !res.body) return res;

    const len = Number(res.headers.get("content-length") ?? 0) || 0;
    const existing = wasmBytes.get(url) ?? { loaded: 0, total: 0 };
    existing.total = len;
    wasmBytes.set(url, existing);
    emitEngineProgress();

    const reader = res.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              controller.enqueue(value);
              const entry = wasmBytes.get(url)!;
              entry.loaded += value.byteLength;
              if (entry.total < entry.loaded) entry.total = entry.loaded;
              emitEngineProgress();
            }
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
    });

    return new Response(stream, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };
}

// Manually-built preview mesh for a flat slab (length × width × thickness),
// oriented in the XY plane starting at the origin. 12 triangles, no
// tessellator involved — safe for arbitrarily many holes in the STEP.
function flatSlabMesh(length: number, width: number, thickness: number): Mesh {
  // 8 corners of the box.
  const v: number[] = [
    0, 0, 0,
    length, 0, 0,
    length, width, 0,
    0, width, 0,
    0, 0, thickness,
    length, 0, thickness,
    length, width, thickness,
    0, width, thickness,
  ];
  // 6 faces × 2 triangles, CCW when looking from outside.
  const idx: number[] = [
    0, 2, 1, 0, 3, 2, // bottom (z=0), normal -Z
    4, 5, 6, 4, 6, 7, // top (z=thickness), normal +Z
    0, 1, 5, 0, 5, 4, // front (y=0), normal -Y
    2, 3, 7, 2, 7, 6, // back (y=width), normal +Y
    1, 2, 6, 1, 6, 5, // right (x=length), normal +X
    0, 4, 7, 0, 7, 3, // left (x=0), normal -X
  ];
  const positions = new Float32Array(v);
  const indices = new Uint32Array(idx);
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz;
    normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz;
    normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
  }
  return { positions, normals, indices };
}

function exportShape(
  oc: OC,
  shape: ShapeHandle,
  format: ExportFormat,
): ExportResult {
  switch (format) {
    case "step": {
      const content = writeStep(oc, shape);
      return {
        format,
        content,
        mime: "application/step",
        extension: "step",
        bytes: content.length,
      };
    }
    case "stl": {
      const content = writeStl(oc, shape);
      return {
        format,
        content,
        mime: "model/stl",
        extension: "stl",
        bytes: content.byteLength,
      };
    }
  }
}

const api = {
  async preload(onProgress?: ProgressCallback): Promise<void> {
    if (engineLoaded) {
      onProgress?.({ kind: "engine_ready" });
      return;
    }
    if (!fetchPatched) {
      patchFetchForWasmProgress();
      fetchPatched = true;
    }
    activeProgressCallback = onProgress ?? null;
    onProgress?.({ kind: "loading_engine" });
    await loadOC();
    engineLoaded = true;
    onProgress?.({ kind: "engine_ready" });
    activeProgressCallback = null;
  },

  isEngineReady(): boolean {
    return engineLoaded;
  },

  // Build a shape for the given spec, keep it cached by partIndex, and
  // return the tessellated mesh for the 3D viewer. No file is written
  // until the user explicitly asks via exportPart().
  async buildPart(
    spec: PartSpec,
    partIndex: number,
    totalParts: number,
    onProgress: ProgressCallback,
  ): Promise<BuildPartResponse> {
    if (!engineLoaded) {
      if (!fetchPatched) {
        patchFetchForWasmProgress();
        fetchPatched = true;
      }
      activeProgressCallback = onProgress;
      onProgress({ kind: "loading_engine" });
    }
    const oc = await loadOC();
    if (!engineLoaded) {
      engineLoaded = true;
      onProgress({ kind: "engine_ready" });
      activeProgressCallback = null;
    }
    onProgress({ kind: "building_part", partIndex, totalParts });
    const { shape, watertight } = buildPart(oc, spec);
    shapeCache.set(partIndex, shape);
    onProgress({ kind: "tessellating", partIndex });
    const mesh = meshFromShape(oc, shape);
    return { mesh, watertight };
  },

  // Export a previously-built shape in the requested format. Caller is
  // responsible for turning `content` into a Blob + download on the
  // main thread.
  async exportPart(
    partIndex: number,
    format: ExportFormat,
  ): Promise<ExportResult> {
    const shape = shapeCache.get(partIndex);
    if (!shape) {
      throw new Error(
        `No hay sólido construido para la pieza ${partIndex + 1}. Pulsa "Construir 3D" primero.`,
      );
    }
    const oc = await loadOC();
    return exportShape(oc, shape, format);
  },

  clearCache(): void {
    shapeCache.clear();
  },

  // Special generator: hex-perforated round tube (no AI, pure
  // parametric). Caches the shape at partIndex so the operator can
  // later call exportPart() to download STEP / STL.
  async buildPerforatedTube(
    args: {
      outer_diameter_mm: number;
      wall_thickness_mm: number;
      length_mm: number;
      hole_diameter_mm: number;
      edge_gap_mm: number;
      end_margin_mm: number;
    },
    partIndex: number,
    onProgress: ProgressCallback,
  ): Promise<{ mesh: Mesh; watertight: boolean; hole_count: number }> {
    if (!engineLoaded) {
      if (!fetchPatched) {
        patchFetchForWasmProgress();
        fetchPatched = true;
      }
      activeProgressCallback = onProgress;
      onProgress({ kind: "loading_engine" });
    }
    const oc = await loadOC();
    if (!engineLoaded) {
      engineLoaded = true;
      onProgress({ kind: "engine_ready" });
      activeProgressCallback = null;
    }
    onProgress({ kind: "building_part", partIndex, totalParts: 1 });
    const { shape, hole_count } = buildPerforatedTubeShape(
      oc,
      args,
      (done, total) => {
        onProgress({
          kind: "batch_progress",
          partIndex,
          done,
          total,
        });
      },
    );
    shapeCache.set(partIndex, shape);
    onProgress({ kind: "tessellating", partIndex });
    // BRepMesh_IncrementalMesh blows the WASM stack when a face has
    // more than a few hundred hole wires (Delaunay recursion depth).
    // Build the preview mesh by hand: a plain rectangular slab of the
    // sheet's dimensions. The STEP file the user downloads still has
    // every hole in it — the preview just isn't the place to render
    // 1500+ circles on a phone.
    const sheetWidth = Math.PI * args.outer_diameter_mm;
    const mesh = flatSlabMesh(
      args.length_mm,
      sheetWidth,
      args.wall_thickness_mm,
    );
    return { mesh, watertight: true, hole_count };
  },
};

export type OccWorkerApi = typeof api;

Comlink.expose(api);

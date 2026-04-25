/// <reference lib="webworker" />
import * as Comlink from "comlink";
import type { PartSpec } from "../part-spec";
import { loadOC } from "./loader";
import { buildPart } from "./build";
import { meshFromShape, type Mesh } from "./mesh-from-shape";
import { writeStep } from "./write-step";
import { writeStl } from "./write-stl";
import type { OC, ShapeHandle } from "./types";

export type WorkerProgress =
  | { kind: "loading_engine" }
  | { kind: "engine_progress"; loaded: number; total: number; files: number }
  | { kind: "engine_ready" }
  | { kind: "building_part"; partIndex: number; totalParts: number }
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
};

export type OccWorkerApi = typeof api;

Comlink.expose(api);

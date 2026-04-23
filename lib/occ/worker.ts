/// <reference lib="webworker" />
import * as Comlink from "comlink";
import type { PartSpec } from "../part-spec";
import { loadOC } from "./loader";
import { buildPart } from "./build";
import { meshFromShape, type Mesh } from "./mesh-from-shape";
import { writeStep } from "./write-step";

export type WorkerProgress =
  | { kind: "loading_engine" }
  | { kind: "engine_progress"; loaded: number; total: number; files: number }
  | { kind: "engine_ready" }
  | { kind: "building_part"; partIndex: number; totalParts: number }
  | { kind: "tessellating"; partIndex: number }
  | { kind: "writing_step"; partIndex: number };

export type BuildPartResponse = {
  mesh: Mesh;
  stepContent: string;
  watertight: boolean;
};

export type ProgressCallback = (event: WorkerProgress) => void;

let engineLoaded = false;
let fetchPatched = false;
let activeProgressCallback: ProgressCallback | null = null;

// Per-URL byte accounting for all .wasm requests fired by
// opencascade.js during init. Totals grow as new modules register
// (Content-Length is only known once the response arrives), so the
// percentage is approximate but gives a useful sense of "almost done".
const wasmBytes = new Map<string, { loaded: number; total: number }>();

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
              // If Content-Length was missing, grow total alongside
              // loaded so the bar never shows >100%.
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

const api = {
  // Called fire-and-forget on page mount so the ~15 MB OpenCascade
  // WASM download starts in parallel with the user picking a file and
  // the Claude vision call. Optionally reports byte-level progress.
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
    onProgress({ kind: "tessellating", partIndex });
    const mesh = meshFromShape(oc, shape);
    onProgress({ kind: "writing_step", partIndex });
    const stepContent = writeStep(oc, shape);
    return { mesh, stepContent, watertight };
  },
};

export type OccWorkerApi = typeof api;

Comlink.expose(api);

/// <reference lib="webworker" />
import * as Comlink from "comlink";
import type { PartSpec } from "../part-spec";
import { loadOC } from "./loader";
import { buildPart } from "./build";
import { meshFromShape, type Mesh } from "./mesh-from-shape";
import { writeStep } from "./write-step";

export type WorkerProgress =
  | { kind: "loading_engine" }
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

const api = {
  // Called fire-and-forget on page mount so the ~15 MB OpenCascade WASM
  // download starts in parallel with the user picking a file and the
  // Claude vision call.
  async preload(): Promise<void> {
    if (engineLoaded) return;
    await loadOC();
    engineLoaded = true;
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
      onProgress({ kind: "loading_engine" });
    }
    const oc = await loadOC();
    if (!engineLoaded) {
      engineLoaded = true;
      onProgress({ kind: "engine_ready" });
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

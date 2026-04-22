/// <reference lib="webworker" />
import * as Comlink from "comlink";
import type { PartSpec } from "../part-spec";
import { loadOC } from "./loader";
import { buildPart } from "./build";
import { meshFromShape, type Mesh } from "./mesh-from-shape";
import { writeStep } from "./write-step";

export type BuildPartResponse = {
  mesh: Mesh;
  stepContent: string;
  watertight: boolean;
};

const api = {
  async buildPart(spec: PartSpec): Promise<BuildPartResponse> {
    const oc = await loadOC();
    const { shape, watertight } = buildPart(oc, spec);
    const mesh = meshFromShape(oc, shape);
    const stepContent = writeStep(oc, shape);
    return { mesh, stepContent, watertight };
  },
};

export type OccWorkerApi = typeof api;

Comlink.expose(api);

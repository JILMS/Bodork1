"use client";
import * as Comlink from "comlink";
import type { OccWorkerApi } from "./worker";

let cached: Comlink.Remote<OccWorkerApi> | null = null;

export function getOccWorker(): Comlink.Remote<OccWorkerApi> {
  if (!cached) {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    cached = Comlink.wrap<OccWorkerApi>(worker);
  }
  return cached;
}

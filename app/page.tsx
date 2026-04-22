"use client";
import dynamic from "next/dynamic";

const SketchToStep = dynamic(() => import("@/components/sketch-to-step"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center text-sm text-bodor-muted">
      Cargando editor…
    </div>
  ),
});

export default function Page() {
  return <SketchToStep />;
}

"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Ensure the error lands in the browser devtools too.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold text-red-400">
        Error al cargar la app
      </h1>
      <p className="text-sm text-bodor-muted">
        Mensaje: <span className="text-bodor-text">{error.message}</span>
      </p>
      {error.digest && (
        <p className="text-xs text-bodor-muted">digest: {error.digest}</p>
      )}
      {error.stack && (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border border-bodor-line bg-bodor-panel p-3 text-xs text-bodor-muted">
          {error.stack}
        </pre>
      )}
      <button
        type="button"
        onClick={reset}
        className="self-start rounded bg-bodor-accent px-4 py-2 text-sm font-semibold text-bodor-bg"
      >
        Reintentar
      </button>
    </main>
  );
}

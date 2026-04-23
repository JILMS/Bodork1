"use client";
import { useCallback } from "react";
import { useDropzone } from "react-dropzone";

type Props = {
  onImage: (file: File) => void;
  disabled?: boolean;
};

export function Dropzone({ onImage, disabled }: Props) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      const f = accepted[0];
      if (f) onImage(f);
    },
    [onImage],
  );
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled,
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".webp"] },
    multiple: false,
  });

  return (
    <div
      {...getRootProps()}
      className={`flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
        disabled
          ? "cursor-not-allowed border-bodor-line opacity-50"
          : isDragActive
            ? "border-bodor-accent bg-bodor-accent/10"
            : "border-bodor-line hover:border-bodor-accent/60 active:border-bodor-accent"
      }`}
    >
      <input
        {...getInputProps({
          // On mobile, launch the camera directly if available.
          capture: "environment",
        })}
      />
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-7 w-7 text-bodor-muted"
        aria-hidden
      >
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="12" cy="12" r="3.2" />
        <path d="M8 5l1.5-2h5L16 5" />
      </svg>
      <p className="text-sm text-bodor-text">
        {isDragActive ? "Suelta la foto aquí…" : "Subir foto del plano"}
      </p>
      <p className="text-[11px] text-bodor-muted">
        Pulsa para elegir o hacer foto · JPG / PNG / WEBP
      </p>
    </div>
  );
}

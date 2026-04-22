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
      className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
        disabled
          ? "cursor-not-allowed border-bodor-line opacity-50"
          : isDragActive
            ? "border-bodor-accent bg-bodor-accent/10"
            : "border-bodor-line hover:border-bodor-accent/60"
      }`}
    >
      <input {...getInputProps()} />
      <p className="text-sm text-bodor-muted">
        {isDragActive
          ? "Suelta la foto aquí…"
          : "Arrastra una foto del plano o pulsa para elegir (JPG / PNG / WEBP)"}
      </p>
    </div>
  );
}

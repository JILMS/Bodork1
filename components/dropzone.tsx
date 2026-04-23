"use client";
import { useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";

type Props = {
  onFile: (file: File) => void;
  disabled?: boolean;
};

const ACCEPT = {
  "image/*": [".jpg", ".jpeg", ".png", ".webp"],
  "application/pdf": [".pdf"],
};

export function Dropzone({ onFile, disabled }: Props) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      const f = accepted[0];
      if (f) onFile(f);
    },
    [onFile],
  );

  // noClick: true → tapping the drop area does NOT open any picker. The
  // user must tap one of the two explicit buttons below, so we never
  // accidentally launch the camera again while a previous upload is
  // still being analyzed.
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled,
    accept: ACCEPT,
    multiple: false,
    noClick: true,
    noKeyboard: true,
  });

  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handlePicked = (f: File | null | undefined) => {
    if (f) onFile(f);
  };

  return (
    <div
      {...getRootProps()}
      className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-5 text-center transition-colors ${
        disabled
          ? "cursor-not-allowed border-bodor-line opacity-50"
          : isDragActive
            ? "border-bodor-accent bg-bodor-accent/10"
            : "border-bodor-line"
      }`}
    >
      <input {...getInputProps()} />

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
        <path d="M12 3v12" />
        <path d="M7 8l5-5 5 5" />
        <rect x="3" y="15" width="18" height="6" rx="1.5" />
      </svg>

      <p className="text-sm text-bodor-text">
        {isDragActive ? "Suelta aquí…" : "Subir plano"}
      </p>
      <p className="text-[11px] text-bodor-muted">
        Imagen (JPG / PNG / WEBP) o PDF · también puedes arrastrar
      </p>

      <div className="grid w-full grid-cols-2 gap-2 pt-1">
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            cameraRef.current?.click();
          }}
          className="flex h-11 items-center justify-center gap-2 rounded bg-bodor-accent px-3 text-sm font-semibold text-bodor-bg transition-colors hover:bg-bodor-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CameraIcon />
          Hacer foto
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            fileRef.current?.click();
          }}
          className="flex h-11 items-center justify-center gap-2 rounded border border-bodor-line bg-bodor-panel px-3 text-sm font-semibold text-bodor-text transition-colors hover:border-bodor-accent/60 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <FileIcon />
          Subir archivo
        </button>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          handlePicked(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        hidden
        onChange={(e) => {
          handlePicked(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function CameraIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <circle cx="12" cy="13" r="3.3" />
      <path d="M8 6l1.5-2h5L16 6" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

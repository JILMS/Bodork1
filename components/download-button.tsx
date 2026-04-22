"use client";

type Props = {
  stepContent: string | null;
  filename: string;
  disabled?: boolean;
};

export function DownloadButton({ stepContent, filename, disabled }: Props) {
  const handle = () => {
    if (!stepContent) return;
    const blob = new Blob([stepContent], { type: "application/step" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <button
      type="button"
      onClick={handle}
      disabled={!stepContent || disabled}
      className="rounded bg-bodor-accent px-4 py-2 text-sm font-semibold text-bodor-bg transition-colors hover:bg-bodor-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      Descargar .STEP
    </button>
  );
}

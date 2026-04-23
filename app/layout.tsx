import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bodor Sketch → STEP",
  description:
    "Convierte fotos de planos técnicos en archivos STEP para corte láser en Bodor K1.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0f14",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-[100dvh] bg-bodor-bg font-mono text-bodor-text antialiased">
        {children}
      </body>
    </html>
  );
}

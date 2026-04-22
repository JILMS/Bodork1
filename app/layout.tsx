import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bodor Sketch → STEP",
  description:
    "Convierte fotos de planos técnicos en archivos STEP para corte láser en Bodor K1.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-bodor-bg font-mono text-bodor-text antialiased">
        {children}
      </body>
    </html>
  );
}

export type UploadPayload = {
  base64: string;
  media_type: string;
  is_pdf: boolean;
};

// Reads a user-selected file for Anthropic's messages API.
// - Images are downscaled to 1600 px on the longest side and re-encoded
//   as JPEG 0.8 (tighter than before to keep the vision call snappy).
// - PDFs are passed straight through as a "document" base64 block.
export async function fileToUploadPayload(file: File): Promise<UploadPayload> {
  if (file.type === "application/pdf") {
    const buf = await file.arrayBuffer();
    return {
      base64: bufferToBase64(new Uint8Array(buf)),
      media_type: "application/pdf",
      is_pdf: true,
    };
  }

  const bmp = await createImageBitmap(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo crear contexto 2D.");
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await canvas.convertToBlob({
    type: "image/jpeg",
    quality: 0.8,
  });
  const buf = await blob.arrayBuffer();
  return {
    base64: bufferToBase64(new Uint8Array(buf)),
    media_type: "image/jpeg",
    is_pdf: false,
  };
}

function bufferToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)) as unknown as number[],
    );
  }
  return btoa(binary);
}

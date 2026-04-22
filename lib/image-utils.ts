// Reads a File as base64 (without the data: URL prefix) for Anthropic's
// vision API. Downscales to max 2048 px on the longest side and re-encodes
// as JPEG 0.85 to keep the payload small.
export async function fileToCompressedBase64(file: File): Promise<{
  base64: string;
  media_type: "image/jpeg";
}> {
  const bmp = await createImageBitmap(file);
  const maxSide = 2048;
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo crear contexto 2D.");
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  const buf = await blob.arrayBuffer();
  return { base64: bufferToBase64(new Uint8Array(buf)), media_type: "image/jpeg" };
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

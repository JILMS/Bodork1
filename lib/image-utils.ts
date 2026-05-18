export type UploadPayload = {
  base64: string;
  media_type: string;
  is_pdf: boolean;
};

const ANTHROPIC_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

// Reads a user-selected file for Anthropic's messages API.
// - PDFs go through unchanged as a "document" base64 block.
// - Images are downscaled to 1600 px on the longest side and re-encoded
//   as JPEG 0.8 to keep the vision call snappy.
// - If decoding fails (some mobile browsers can't decode HEIC, HDR or
//   certain progressive JPEGs via createImageBitmap), we fall back to
//   <img> + canvas, and finally to passing the original bytes through
//   without resizing so the user always gets *some* response.
export async function fileToUploadPayload(file: File): Promise<UploadPayload> {
  if (file.type === "application/pdf") {
    if (file.size > MAX_JPEG_BYTES) {
      throw new Error(
        `El PDF pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. Vercel acepta hasta 2,5 MB por petición. Comprime el PDF o conviértelo a JPG antes de subirlo.`,
      );
    }
    const buf = await file.arrayBuffer();
    return {
      base64: bufferToBase64(new Uint8Array(buf)),
      media_type: "application/pdf",
      is_pdf: true,
    };
  }

  // Path 1: fast path with createImageBitmap + OffscreenCanvas.
  try {
    return await decodeWithImageBitmap(file);
  } catch (_e) {
    // fall through
  }

  // Path 2: <img> + HTMLCanvasElement. Handles more JPEG variants on
  // mobile browsers that choke on createImageBitmap.
  try {
    return await decodeWithImgElement(file);
  } catch (_e) {
    // fall through
  }

  // Path 3: pass-through. If the file is already a format Anthropic
  // accepts (jpeg / png / webp / gif) AND it fits the Vercel body
  // limit, send the bytes as-is. Otherwise we have no fallback and
  // the throw below reports a clear error.
  if (
    ANTHROPIC_IMAGE_MIME.has(file.type) &&
    file.size <= MAX_JPEG_BYTES
  ) {
    const buf = await file.arrayBuffer();
    return {
      base64: bufferToBase64(new Uint8Array(buf)),
      media_type: file.type,
      is_pdf: false,
    };
  }

  // Final guard: nothing worked. Throw a clear, actionable message so
  // the UI shows something useful.
  throw new Error(
    `No se pudo decodificar la imagen (${file.type || "tipo desconocido"}). ` +
      `Si la sacaste con un iPhone, puede ser HEIC: cámbiala a "Más compatible" ` +
      `en Ajustes → Cámara → Formatos, o conviértela a JPG/PNG y vuelve a subirla.`,
  );
}

async function decodeWithImageBitmap(file: File): Promise<UploadPayload> {
  const bmp = await createImageBitmap(file);
  const { canvas, ctx, w, h } = makeCanvas(bmp.width, bmp.height);
  ctx.drawImage(bmp, 0, 0, w, h);
  return canvasToJpegPayload(canvas);
}

async function decodeWithImgElement(file: File): Promise<UploadPayload> {
  const url = URL.createObjectURL(file);
  try {
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("img load failed"));
      el.crossOrigin = "anonymous";
      el.src = url;
    });
    const { canvas, ctx, w, h } = makeCanvas(
      img.naturalWidth || img.width,
      img.naturalHeight || img.height,
    );
    ctx.drawImage(img, 0, 0, w, h);
    return canvasToJpegPayload(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

type CanvasLike =
  | { kind: "off"; canvas: OffscreenCanvas }
  | { kind: "html"; canvas: HTMLCanvasElement };

function makeCanvas(srcW: number, srcH: number): {
  canvas: CanvasLike;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  w: number;
  h: number;
} {
  // 2048 px on the longest side gives Anthropic enough detail to read
  // small hand-written cotas reliably. A typical phone photo lands
  // around 2-3 MB after this, well under the 5 MB per-image limit.
  // The earlier 1280-px setting was too aggressive: thin cotas like
  // "08" / "80" / "60" got mushed and the model misread them.
  const maxSide = 2048;
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  // Prefer OffscreenCanvas on the worker-y main thread, otherwise use
  // a hidden HTMLCanvasElement (path 2 needs this anyway for <img>
  // compatibility with .toBlob).
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
    return { canvas: { kind: "off", canvas: c }, ctx, w, h };
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  return { canvas: { kind: "html", canvas: c }, ctx, w, h };
}

// Vercel serverless functions reject request bodies >4 MB. base64
// inflates the JPEG by ~33 %, so we cap the JPEG itself at 2.5 MB.
// If the first encode is bigger we drop the quality progressively.
const MAX_JPEG_BYTES = 2_500_000;
const QUALITY_LADDER = [0.92, 0.85, 0.75, 0.65, 0.55];

async function encodeCanvas(c: CanvasLike, q: number): Promise<Blob> {
  if (c.kind === "off") {
    return c.canvas.convertToBlob({ type: "image/jpeg", quality: q });
  }
  return new Promise<Blob>((resolve, reject) => {
    c.canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      "image/jpeg",
      q,
    );
  });
}

async function canvasToJpegPayload(c: CanvasLike): Promise<UploadPayload> {
  let blob: Blob | null = null;
  for (const q of QUALITY_LADDER) {
    blob = await encodeCanvas(c, q);
    if (blob.size <= MAX_JPEG_BYTES) break;
  }
  if (!blob) throw new Error("No se pudo comprimir la imagen.");
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

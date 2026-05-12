import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { DrawingZ, DRAWING_JSON_SCHEMA } from "@/lib/part-spec";
import {
  VISION_SYSTEM_PROMPT,
  SUBMIT_DRAWING_TOOL_DESCRIPTION,
} from "@/lib/anthropic-prompt";

export const runtime = "nodejs";
// Vercel hobby caps Node functions at 60s of CPU but allows much
// longer when the response is streamed. We stream Server-Sent Events
// so the connection stays alive while Anthropic deliberates.
export const maxDuration = 300;

type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
type DocumentMediaType = "application/pdf";
type AnyMediaType = ImageMediaType | DocumentMediaType;

type AnalyzeBody = {
  image_base64: string;
  media_type: AnyMediaType;
  hints?: {
    default_material?: string;
    default_thickness_mm?: number;
    force_profile_kind?: string;
    force_corner_radius_mm?: number;
  };
};

function sseResponse(
  factory: (
    send: (event: string, data: unknown) => void,
  ) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(
            `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
          ),
        );
      };
      const ka = setInterval(() => {
        // SSE comment line: ignored by clients but keeps the TCP
        // connection alive past Vercel's idle-cut threshold.
        try {
          controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
        } catch {
          /* controller closed */
        }
      }, 10_000);
      try {
        await factory(send);
      } catch (e) {
        send("error", { error: (e as Error).message });
      } finally {
        clearInterval(ka);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return sseResponse(async (send) => {
      send("error", { error: "ANTHROPIC_API_KEY no configurada en el servidor." });
    });
  }

  let body: AnalyzeBody;
  try {
    body = (await req.json()) as AnalyzeBody;
  } catch {
    return sseResponse(async (send) => {
      send("error", { error: "JSON inválido." });
    });
  }

  if (!body.image_base64 || !body.media_type) {
    return sseResponse(async (send) => {
      send("error", { error: "Faltan campos image_base64 y media_type." });
    });
  }

  const anthropic = new Anthropic({ apiKey });

  const hintParts: string[] = [];
  if (body.hints?.default_material) {
    hintParts.push(`material por defecto = ${body.hints.default_material}`);
  }
  if (body.hints?.default_thickness_mm) {
    hintParts.push(
      `espesor por defecto si falta en plano = ${body.hints.default_thickness_mm} mm`,
    );
  }
  if (body.hints?.force_profile_kind) {
    hintParts.push(
      `FORZAR tipo de perfil = ${body.hints.force_profile_kind} (tiene prioridad sobre lo que sugiera el plano)`,
    );
  }
  if (body.hints?.force_corner_radius_mm !== undefined) {
    hintParts.push(
      `radio de esquina para tubos = ${body.hints.force_corner_radius_mm} mm`,
    );
  }
  const hintText = hintParts.length
    ? `Pistas del operario: ${hintParts.join("; ")}.`
    : "Sin pistas adicionales.";

  const isPdf = body.media_type === "application/pdf";

  const inputBlock: Anthropic.Messages.ContentBlockParam = isPdf
    ? {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: body.image_base64,
        },
      }
    : {
        type: "image",
        source: {
          type: "base64",
          media_type: body.media_type as ImageMediaType,
          data: body.image_base64,
        },
      };

  const tools: Anthropic.Messages.ToolUnion[] = [
    {
      name: "submit_drawing",
      description: SUBMIT_DRAWING_TOOL_DESCRIPTION,
      input_schema:
        DRAWING_JSON_SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
      cache_control: { type: "ephemeral" },
    },
  ];

  const baseSystem: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: VISION_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
  ];

  const userContent: Anthropic.Messages.ContentBlockParam[] = [
    inputBlock,
    { type: "text", text: hintText },
  ];

  return sseResponse(async (send) => {
    send("stage", { stage: "calling_claude" });

    let response: Anthropic.Messages.Message;
    try {
      response = await anthropic.messages.create({
        model: "claude-opus-4-7",
        max_tokens: 16_000,
        // Adaptive thinking + medium effort: high quality without
        // blowing past the Vercel timeout. Operator can re-run a
        // tougher plan with the manual editor if needed.
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: baseSystem,
        tools,
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: userContent }],
      });
    } catch (e) {
      send("error", {
        error: `Error llamando a Anthropic: ${(e as Error).message}`,
      });
      return;
    }

    let toolUse = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock =>
        block.type === "tool_use",
    );

    if (!toolUse) {
      send("stage", { stage: "fallback_force_tool" });
      try {
        const followup = await anthropic.messages.create({
          model: "claude-opus-4-7",
          max_tokens: 8000,
          system: baseSystem,
          tools,
          tool_choice: { type: "tool", name: "submit_drawing" },
          messages: [
            { role: "user", content: userContent },
            {
              role: "assistant",
              content: response.content.filter(
                (b): b is Anthropic.Messages.TextBlock => b.type === "text",
              ),
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Ahora llama a submit_drawing con la lista COMPLETA de piezas, agujeros, slots y recortes — incluyendo todos los que enumeraste. No dejes ninguno fuera.",
                },
              ],
            },
          ],
        });
        toolUse = followup.content.find(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
        );
      } catch (e) {
        send("error", {
          error: `El modelo no llamó a submit_drawing y el fallback falló: ${(e as Error).message}`,
        });
        return;
      }
    }

    if (!toolUse) {
      send("error", {
        error:
          "El modelo no devolvió una llamada a submit_drawing. Reintenta con otra foto o un PDF más nítido.",
      });
      return;
    }

    const parsed = DrawingZ.safeParse(toolUse.input);
    if (!parsed.success) {
      send("error", {
        error:
          "La interpretación del plano no cumple el esquema. Prueba con una foto más nítida.",
        issues: parsed.error.issues,
      });
      return;
    }

    send("done", {
      drawing: parsed.data,
      usage: response.usage,
    });
  });
}

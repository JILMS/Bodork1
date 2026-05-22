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
        // connection alive past mobile-carrier NAT idle timeouts
        // (commonly 30-60 s of inactivity).
        try {
          controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
        } catch {
          /* controller closed */
        }
      }, 5_000);
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

  return sseResponse(async (send) => {
    // PASS 0 — outer-rectangle dimensions only.
    // Many plans confuse Claude because it tries to read all cotas
    // (exterior + interior of slots/holes) at once. Splitting the
    // job in two makes each step very simple and almost impossible
    // to get wrong. Pass 0: "look at the plan, identify the OUTER
    // rectangle of each piece, return ONLY length_mm and width_mm".
    send("stage", { stage: "outer_dims" });
    let outerHint = "";
    try {
      const outerSchema = {
        type: "object" as const,
        required: ["pieces"],
        properties: {
          pieces: {
            type: "array",
            description:
              "One entry per distinct rectangular piece in the plan.",
            items: {
              type: "object",
              required: ["length_mm", "width_mm"],
              properties: {
                length_mm: {
                  type: "number",
                  description:
                    "Longer outer side of the rectangle, in mm.",
                },
                width_mm: {
                  type: "number",
                  description:
                    "Shorter outer side of the rectangle, in mm.",
                },
                name: { type: "string" },
                confidence: {
                  type: "string",
                  enum: ["alta", "media", "baja"],
                },
              },
            },
          },
        },
      };
      const outerSystem: Anthropic.Messages.TextBlockParam[] = [
        {
          type: "text",
          text:
            "Eres un inspector de planos de taller. Tu ÚNICA tarea ahora " +
            "es identificar el RECTÁNGULO EXTERIOR de cada pieza. NO mires " +
            "agujeros, slots ni recortes. Mira sólo las cotas con flechas " +
            "que apuntan a los bordes del rectángulo grande — esas son las " +
            "dimensiones de la pieza. Devuelve length_mm = cota más larga, " +
            "width_mm = cota más corta. Marca confidence='baja' si la foto " +
            "está borrosa o tienes dudas. Usa SIEMPRE submit_outer.",
          cache_control: { type: "ephemeral" },
        },
      ];
      const outerResp = await anthropic.messages.create({
        model: "claude-opus-4-7",
        max_tokens: 2000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: outerSystem,
        tools: [
          {
            name: "submit_outer",
            description: "Entrega las dimensiones exteriores.",
            input_schema:
              outerSchema as unknown as Anthropic.Messages.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: [inputBlock] }],
      });
      const outerTool = outerResp.content.find(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
      );
      if (outerTool) {
        const data = outerTool.input as {
          pieces?: Array<{
            length_mm?: number;
            width_mm?: number;
            name?: string;
            confidence?: string;
          }>;
        };
        if (data.pieces && data.pieces.length > 0) {
          outerHint =
            "RECTÁNGULOS EXTERIORES YA IDENTIFICADOS (úsalos como length × width de cada pieza, NO los confundas con cotas de slots):\n" +
            data.pieces
              .map(
                (p, i) =>
                  `  - Pieza ${i + 1}${p.name ? ` (${p.name})` : ""}: ` +
                  `${p.length_mm ?? "?"} × ${p.width_mm ?? "?"} mm` +
                  (p.confidence ? ` [confianza: ${p.confidence}]` : ""),
              )
              .join("\n");
        }
      }
    } catch {
      // Best-effort. If pass 0 fails, pass 1 still runs with full prompt.
    }

    send("stage", { stage: "calling_claude" });

    // Build the user content for pass 1, injecting the outer-rect
    // dimensions from pass 0 if we have them.
    const pass1UserContent: Anthropic.Messages.ContentBlockParam[] = [
      inputBlock,
      { type: "text", text: hintText },
    ];
    if (outerHint) {
      pass1UserContent.push({ type: "text", text: outerHint });
    }

    let response: Anthropic.Messages.Message;
    try {
      response = await anthropic.messages.create({
        model: "claude-opus-4-7",
        max_tokens: 16_000,
        // High-precision but mobile-friendly: "xhigh" routinely
        // pushed past 90 s on dense plans, and mobile carriers were
        // killing the SSE connection mid-stream. "high" still gives
        // very strong recall, completes in 25-45 s typical.
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: baseSystem,
        tools,
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: pass1UserContent }],
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
            { role: "user", content: pass1UserContent },
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

    // "Equilibrado" mode (operator's choice): 2 passes only — outer
    // contour (pass 0) + features (pass 1). The third verification
    // pass was dropped to roughly halve the per-plan API cost; the
    // 2-stage pipeline already resolves the outer/inner cota
    // confusion that caused the hourglass artifacts.
    send("done", {
      drawing: parsed.data,
      usage: response.usage,
    });
  });
}

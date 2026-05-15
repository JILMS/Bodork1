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
        // Max-precision mode: xhigh effort is one step below "max".
        // Combined with the SSE streaming + 2-model verification pass
        // below it gives us the highest realistic recall on dense
        // engineering plans. Cost / time goes up; the operator
        // explicitly asked for "que lo lea todo bien".
        thinking: { type: "adaptive" },
        output_config: { effort: "xhigh" },
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

    // Maximum-precision verification pass: feed the ORIGINAL drawing
    // back to Opus 4.7 alongside its own first-pass JSON and ask it
    // explicitly to find anything missed (extra holes, slots,
    // cutouts, wrong dimensions). The model returns a CORRECTED FULL
    // JSON; we keep the verified version when it parses cleanly,
    // otherwise we ship the original. Best-effort: any error in
    // verification doesn't break the flow.
    let finalDrawing = parsed.data;
    try {
      send("stage", { stage: "verifying" });
      const verifyContent: Anthropic.Messages.ContentBlockParam[] = [
        inputBlock,
        {
          type: "text",
          text:
            "Un primer modelo te ha entregado este JSON extraído del plano:\n\n" +
            "```json\n" +
            JSON.stringify(parsed.data, null, 2) +
            "\n```\n\n" +
            "Vuelve a mirar EL PLANO ORIGINAL con detalle y revisa, vista por vista:\n" +
            "1. ¿Hay algún agujero redondo (círculo) en el plano que NO esté en el JSON? Cuéntalos todos.\n" +
            "2. ¿Hay algún agujero oblongo / coliso / slot que falte?\n" +
            "3. ¿Hay algún recorte rectangular o muesca de extremo que falte?\n" +
            "4. ¿Alguna dimensión clave (length, width, thickness, posiciones) está mal leída?\n" +
            "5. ¿Sobra algo que en realidad no existe?\n\n" +
            "Llama a submit_drawing con el JSON CORREGIDO COMPLETO (todas las piezas, todos los features). Si el JSON original ya está perfecto, devuélvelo tal cual.",
        },
      ];
      const verify = await anthropic.messages.create({
        model: "claude-opus-4-7",
        max_tokens: 16_000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: baseSystem,
        tools,
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: verifyContent }],
      });
      const verifyTool = verify.content.find(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
      );
      if (verifyTool) {
        const verifiedParsed = DrawingZ.safeParse(verifyTool.input);
        if (verifiedParsed.success) {
          // Sanity guard: keep verified only if it has at least as
          // many features as the original. The verifier should add,
          // not remove (unless it spotted something the first pass
          // hallucinated). If the count drops dramatically (e.g. >40
          // %), keep the more complete first pass.
          const totalFeats = (d: typeof finalDrawing) =>
            d.parts.reduce((n, p) => {
              const pr = p.profile;
              if (
                pr.kind === "flat_bar" ||
                pr.kind === "angle_profile"
              )
                return (
                  n +
                  pr.holes.length +
                  pr.slots.length +
                  pr.cutouts.length
                );
              if (
                pr.kind === "round_tube" ||
                pr.kind === "square_tube" ||
                pr.kind === "rectangular_tube"
              )
                return n + pr.holes.length;
              return n;
            }, 0);
          const before = totalFeats(parsed.data);
          const after = totalFeats(verifiedParsed.data);
          if (after >= before * 0.6) {
            finalDrawing = verifiedParsed.data;
          }
        }
      }
    } catch {
      // Verification is best-effort; ship the original on any error.
    }

    send("done", {
      drawing: finalDrawing,
      usage: response.usage,
    });
  });
}

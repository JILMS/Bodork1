import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { DrawingZ, DRAWING_JSON_SCHEMA } from "@/lib/part-spec";
import {
  VISION_SYSTEM_PROMPT,
  SUBMIT_DRAWING_TOOL_DESCRIPTION,
} from "@/lib/anthropic-prompt";

export const runtime = "nodejs";
// Extended thinking + tool use on a dense engineering drawing can take
// a while; bump the function timeout accordingly.
export const maxDuration = 120;

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

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY no configurada en el servidor." },
      { status: 500 },
    );
  }

  let body: AnalyzeBody;
  try {
    body = (await req.json()) as AnalyzeBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  if (!body.image_base64 || !body.media_type) {
    return NextResponse.json(
      { error: "Faltan campos image_base64 y media_type." },
      { status: 400 },
    );
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

  // Use Opus 4.7 with extended thinking for maximum accuracy on dense
  // engineering drawings. Sonnet 4.6 was faster but missed features.
  // Extended thinking lets the model deliberate and self-check before
  // emitting the structured tool call.
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

  // First attempt: thinking enabled, tool_choice = auto (forced choice
  // is incompatible with extended thinking). The strong system prompt
  // tells the model to call submit_drawing.
  let response: Anthropic.Messages.Message;
  try {
    response = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 16_000,
      thinking: { type: "enabled", budget_tokens: 5000 },
      system: baseSystem,
      tools,
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: userContent }],
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: `Error llamando a Anthropic: ${(e as Error).message}`,
      },
      { status: 502 },
    );
  }

  let toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === "tool_use",
  );

  // Fallback: if the model produced text but no tool_use, send a
  // follow-up that forces the tool call (no thinking — forced choice
  // is allowed without thinking).
  if (!toolUse) {
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
      return NextResponse.json(
        {
          error: `El modelo no llamó a submit_drawing y el fallback falló: ${(e as Error).message}`,
          raw: response.content,
        },
        { status: 502 },
      );
    }
  }

  if (!toolUse) {
    return NextResponse.json(
      {
        error:
          "El modelo no devolvió una llamada a submit_drawing. Reintenta con otra foto o un PDF más nítido.",
        raw: response.content,
      },
      { status: 502 },
    );
  }

  const parsed = DrawingZ.safeParse(toolUse.input);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "La interpretación del plano no cumple el esquema. Prueba con una foto más nítida.",
        issues: parsed.error.issues,
        raw: toolUse.input,
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    drawing: parsed.data,
    usage: response.usage,
  });
}

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { DrawingZ, DRAWING_JSON_SCHEMA } from "@/lib/part-spec";
import {
  VISION_SYSTEM_PROMPT,
  SUBMIT_DRAWING_TOOL_DESCRIPTION,
} from "@/lib/anthropic-prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

type AnalyzeBody = {
  image_base64: string;
  media_type: "image/jpeg" | "image/png" | "image/webp";
  hints?: {
    default_material?: string;
    default_thickness_mm?: number;
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

  const hintText = body.hints
    ? `Pistas del operario: material por defecto = ${body.hints.default_material ?? "acero_carbono"}, espesor por defecto si falta en plano = ${body.hints.default_thickness_mm ?? "no especificado"} mm.`
    : "Sin pistas adicionales.";

  const response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: VISION_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      {
        name: "submit_drawing",
        description: SUBMIT_DRAWING_TOOL_DESCRIPTION,
        input_schema: DRAWING_JSON_SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
        cache_control: { type: "ephemeral" },
      },
    ],
    tool_choice: { type: "tool", name: "submit_drawing" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: body.media_type,
              data: body.image_base64,
            },
          },
          { type: "text", text: hintText },
        ],
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    return NextResponse.json(
      {
        error:
          "El modelo no devolvió una llamada a submit_drawing. Reintenta con otra foto.",
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

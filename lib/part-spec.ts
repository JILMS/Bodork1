import { z } from "zod";

export const MaterialZ = z.enum([
  "hierro",
  "acero_carbono",
  "acero_inox",
  "aluminio",
  "galvanizado",
]);

export const HoleZ = z.object({
  diameter_mm: z.number().positive(),
  position_mm: z.number().nonnegative(),
  edge_offset_mm: z.number().optional(),
  type: z.enum(["through", "countersunk"]).default("through"),
});

export const EndCutZ = z.object({
  angle_deg: z.number().min(1).max(179),
});

const EndsZ = z
  .object({ start: EndCutZ.optional(), end: EndCutZ.optional() })
  .optional();

export const FlatBarZ = z.object({
  kind: z.literal("flat_bar"),
  length_mm: z.number().positive(),
  width_mm: z.number().positive(),
  thickness_mm: z.number().positive(),
  holes: z.array(HoleZ).default([]),
  ends: EndsZ,
});

export const RoundTubeZ = z.object({
  kind: z.literal("round_tube"),
  length_mm: z.number().positive(),
  outer_diameter_mm: z.number().positive(),
  wall_thickness_mm: z.number().positive(),
  holes: z
    .array(HoleZ.extend({ face_angle_deg: z.number().default(0) }))
    .default([]),
  ends: EndsZ,
});

export const SquareTubeZ = z.object({
  kind: z.literal("square_tube"),
  length_mm: z.number().positive(),
  side_mm: z.number().positive(),
  wall_thickness_mm: z.number().positive(),
  corner_radius_mm: z.number().nonnegative().optional(),
  holes: z
    .array(HoleZ.extend({ face: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) }))
    .default([]),
  ends: EndsZ,
});

export const RectangularTubeZ = z.object({
  kind: z.literal("rectangular_tube"),
  length_mm: z.number().positive(),
  width_mm: z.number().positive(),
  height_mm: z.number().positive(),
  wall_thickness_mm: z.number().positive(),
  corner_radius_mm: z.number().nonnegative().optional(),
  holes: z
    .array(
      HoleZ.extend({
        face: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      }),
    )
    .default([]),
  ends: EndsZ,
});

export const AngleProfileZ = z.object({
  kind: z.literal("angle_profile"),
  length_mm: z.number().positive(),
  leg_a_mm: z.number().positive(),
  leg_b_mm: z.number().positive(),
  thickness_mm: z.number().positive(),
  holes: z
    .array(HoleZ.extend({ leg: z.enum(["a", "b"]) }))
    .default([]),
  ends: EndsZ,
});

export const ProfileZ = z.discriminatedUnion("kind", [
  FlatBarZ,
  RoundTubeZ,
  SquareTubeZ,
  RectangularTubeZ,
  AngleProfileZ,
]);

export const PartSpecZ = z.object({
  name: z.string().optional(),
  material: MaterialZ.default("acero_carbono"),
  quantity: z.number().int().positive().default(1),
  profile: ProfileZ,
  notes: z.string().optional(),
});

export const DrawingZ = z.object({
  parts: z.array(PartSpecZ).min(1),
});

export type Material = z.infer<typeof MaterialZ>;
export type Hole = z.infer<typeof HoleZ>;
export type EndCut = z.infer<typeof EndCutZ>;
export type FlatBar = z.infer<typeof FlatBarZ>;
export type RoundTube = z.infer<typeof RoundTubeZ>;
export type SquareTube = z.infer<typeof SquareTubeZ>;
export type RectangularTube = z.infer<typeof RectangularTubeZ>;
export type AngleProfile = z.infer<typeof AngleProfileZ>;
export type Profile = z.infer<typeof ProfileZ>;
export type PartSpec = z.infer<typeof PartSpecZ>;
export type Drawing = z.infer<typeof DrawingZ>;

// JSON Schema describing the tool input for the Anthropic tool_use.
// Kept hand-written (instead of zod-to-json-schema) to guarantee a shape
// the Messages API accepts without extra dependencies.
export const DRAWING_JSON_SCHEMA = {
  type: "object",
  required: ["parts"],
  properties: {
    parts: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["profile"],
        properties: {
          name: { type: "string" },
          material: {
            type: "string",
            enum: [
              "hierro",
              "acero_carbono",
              "acero_inox",
              "aluminio",
              "galvanizado",
            ],
          },
          quantity: { type: "integer", minimum: 1 },
          notes: { type: "string" },
          profile: {
            oneOf: [
              {
                type: "object",
                required: ["kind", "length_mm", "width_mm", "thickness_mm"],
                properties: {
                  kind: { const: "flat_bar" },
                  length_mm: { type: "number" },
                  width_mm: { type: "number" },
                  thickness_mm: { type: "number" },
                  holes: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["diameter_mm", "position_mm"],
                      properties: {
                        diameter_mm: { type: "number" },
                        position_mm: { type: "number" },
                        edge_offset_mm: { type: "number" },
                        type: { enum: ["through", "countersunk"] },
                      },
                    },
                  },
                  ends: endsSchema(),
                },
              },
              {
                type: "object",
                required: [
                  "kind",
                  "length_mm",
                  "outer_diameter_mm",
                  "wall_thickness_mm",
                ],
                properties: {
                  kind: { const: "round_tube" },
                  length_mm: { type: "number" },
                  outer_diameter_mm: { type: "number" },
                  wall_thickness_mm: { type: "number" },
                  holes: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["diameter_mm", "position_mm"],
                      properties: {
                        diameter_mm: { type: "number" },
                        position_mm: { type: "number" },
                        face_angle_deg: { type: "number" },
                        type: { enum: ["through", "countersunk"] },
                      },
                    },
                  },
                  ends: endsSchema(),
                },
              },
              {
                type: "object",
                required: ["kind", "length_mm", "side_mm", "wall_thickness_mm"],
                properties: {
                  kind: { const: "square_tube" },
                  length_mm: { type: "number" },
                  side_mm: { type: "number" },
                  wall_thickness_mm: { type: "number" },
                  corner_radius_mm: { type: "number" },
                  holes: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["diameter_mm", "position_mm", "face"],
                      properties: {
                        diameter_mm: { type: "number" },
                        position_mm: { type: "number" },
                        face: { enum: [1, 2, 3, 4] },
                        type: { enum: ["through", "countersunk"] },
                      },
                    },
                  },
                  ends: endsSchema(),
                },
              },
              {
                type: "object",
                required: [
                  "kind",
                  "length_mm",
                  "width_mm",
                  "height_mm",
                  "wall_thickness_mm",
                ],
                properties: {
                  kind: { const: "rectangular_tube" },
                  length_mm: { type: "number" },
                  width_mm: { type: "number" },
                  height_mm: { type: "number" },
                  wall_thickness_mm: { type: "number" },
                  corner_radius_mm: { type: "number" },
                  holes: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["diameter_mm", "position_mm", "face"],
                      properties: {
                        diameter_mm: { type: "number" },
                        position_mm: { type: "number" },
                        face: { enum: [1, 2, 3, 4] },
                        type: { enum: ["through", "countersunk"] },
                      },
                    },
                  },
                  ends: endsSchema(),
                },
              },
              {
                type: "object",
                required: [
                  "kind",
                  "length_mm",
                  "leg_a_mm",
                  "leg_b_mm",
                  "thickness_mm",
                ],
                properties: {
                  kind: { const: "angle_profile" },
                  length_mm: { type: "number" },
                  leg_a_mm: { type: "number" },
                  leg_b_mm: { type: "number" },
                  thickness_mm: { type: "number" },
                  holes: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["diameter_mm", "position_mm", "leg"],
                      properties: {
                        diameter_mm: { type: "number" },
                        position_mm: { type: "number" },
                        leg: { enum: ["a", "b"] },
                        type: { enum: ["through", "countersunk"] },
                      },
                    },
                  },
                  ends: endsSchema(),
                },
              },
            ],
          },
        },
      },
    },
  },
} as const;

function endsSchema() {
  return {
    type: "object",
    properties: {
      start: {
        type: "object",
        properties: { angle_deg: { type: "number" } },
        required: ["angle_deg"],
      },
      end: {
        type: "object",
        properties: { angle_deg: { type: "number" } },
        required: ["angle_deg"],
      },
    },
  };
}

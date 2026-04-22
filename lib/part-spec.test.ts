import { describe, expect, it } from "vitest";
import { DrawingZ } from "./part-spec";

describe("DrawingZ", () => {
  it("parses the example pletinas drawing", () => {
    const input = {
      parts: [
        {
          name: "PLETINA DE 50X10",
          material: "acero_carbono",
          quantity: 14,
          profile: {
            kind: "flat_bar",
            length_mm: 1395,
            width_mm: 50,
            thickness_mm: 10,
            holes: [
              { diameter_mm: 13, position_mm: 58, edge_offset_mm: 25, type: "through" },
              { diameter_mm: 13, position_mm: 477, edge_offset_mm: 25, type: "through" },
              { diameter_mm: 27, position_mm: 735, edge_offset_mm: 25, type: "countersunk" },
              { diameter_mm: 13, position_mm: 1395 - 420, edge_offset_mm: 25, type: "through" },
              { diameter_mm: 13, position_mm: 1395 - 63, edge_offset_mm: 25, type: "through" },
            ],
          },
        },
        {
          name: "PLETINA DE 50X5",
          material: "acero_carbono",
          quantity: 12,
          profile: {
            kind: "flat_bar",
            length_mm: 975,
            width_mm: 50,
            thickness_mm: 5,
            holes: [
              { diameter_mm: 13, position_mm: 58, edge_offset_mm: 25, type: "through" },
              { diameter_mm: 13, position_mm: 975 - 448, edge_offset_mm: 25, type: "through" },
              { diameter_mm: 13, position_mm: 975 - 50, edge_offset_mm: 25, type: "through" },
            ],
          },
        },
      ],
    };
    const parsed = DrawingZ.parse(input);
    expect(parsed.parts).toHaveLength(2);
    expect(parsed.parts[0].profile.kind).toBe("flat_bar");
    if (parsed.parts[0].profile.kind === "flat_bar") {
      expect(parsed.parts[0].profile.thickness_mm).toBe(10);
      expect(parsed.parts[0].profile.holes).toHaveLength(5);
    }
  });

  it("rejects negative dimensions", () => {
    const bad = {
      parts: [
        {
          profile: {
            kind: "flat_bar",
            length_mm: -1,
            width_mm: 50,
            thickness_mm: 10,
          },
        },
      ],
    };
    expect(DrawingZ.safeParse(bad).success).toBe(false);
  });

  it("accepts a round tube spec", () => {
    const good = {
      parts: [
        {
          profile: {
            kind: "round_tube",
            length_mm: 1000,
            outer_diameter_mm: 40,
            wall_thickness_mm: 2,
            holes: [{ diameter_mm: 8, position_mm: 500, face_angle_deg: 90 }],
          },
        },
      ],
    };
    const parsed = DrawingZ.parse(good);
    expect(parsed.parts[0].profile.kind).toBe("round_tube");
  });
});

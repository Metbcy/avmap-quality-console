import { describe, it, expect } from "vitest";
import { verdictFor } from "@/components/ReadinessVerdict";
import type { TileProperties } from "@/lib/scoring";
import type { Flag } from "@/lib/validators";

function tile(score: number): TileProperties {
  return {
    tile_id: "T-000-000",
    city: "sf",
    lat: 37.77,
    lng: -122.44,
    lane_marking_confidence: 0.8,
    construction_flag: false,
    sensor_divergence_score: 0.2,
    stop_sign_confidence: 0.8,
    readiness_score: score,
    last_validated_at: "2026-05-29T00:00:00.000Z",
    bucket: score >= 0.9 ? 2 : score >= 0.75 ? 1 : 0,
  };
}

function flag(severity: "low" | "med" | "high"): Flag {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-122.44, 37.77] },
    properties: {
      rule_id: "test.rule",
      severity,
      description: "test",
    },
  } as Flag;
}

describe("verdictFor", () => {
  it("returns ready verdict for high score with no flags", () => {
    const v = verdictFor(tile(0.95), []);
    expect(v.headline).toMatch(/Ready for autonomous driving/);
    expect(v.emoji).toBe("✅");
  });

  it("returns hard-block verdict when any high-severity flag is present, regardless of score", () => {
    const v = verdictFor(tile(0.99), [flag("high")]);
    expect(v.headline).toMatch(/Not safe/);
    expect(v.emoji).toBe("🛑");
  });

  it("returns caution verdict for mid score", () => {
    const v = verdictFor(tile(0.8), [flag("med")]);
    expect(v.headline).toMatch(/Drivable with caution/);
    expect(v.emoji).toBe("⚠️");
  });

  it("returns needs-work verdict for low score", () => {
    const v = verdictFor(tile(0.5), []);
    expect(v.headline).toMatch(/Needs map work/);
    expect(v.emoji).toBe("🚧");
  });

  it("downgrades a 0.92 score with a med flag from ready to caution", () => {
    const v = verdictFor(tile(0.92), [flag("med")]);
    expect(v.headline).toMatch(/Drivable with caution/);
  });
});

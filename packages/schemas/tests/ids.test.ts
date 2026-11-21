import { describe, expect, it } from "vitest";
import {
  generateId,
  sampleId,
  ALL_ID_PREFIXES,
  idPrefix,
  ProjectId,
  SegmentId,
  ClipId,
  UploadSessionId,
  type IdPrefix,
} from "../src/index.js";

describe("ID contract (invariant #1)", () => {
  it("generates IDs matching the shared pattern for every prefix", () => {
    // Deterministic rng for reproducibility.
    let seed = 42;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (const prefix of ALL_ID_PREFIXES) {
      const id = generateId(prefix, rng);
      expect(id.startsWith(`${prefix}_`), `${id} should start with ${prefix}_`).toBe(true);
      expect(idPrefix(id)).toBe(prefix);
    }
  });

  it("sampleId is deterministic and contract-valid", () => {
    expect(sampleId("prj", 1)).toBe("prj_SAMPLE000001");
    expect(sampleId("seg", 42)).toBe("seg_SAMPLE000042");
    expect(ProjectId.safeParse(sampleId("prj", 7)).success).toBe(true);
    expect(SegmentId.safeParse(sampleId("seg", 7)).success).toBe(true);
    expect(ClipId.safeParse(sampleId("seg", 7)).success).toBe(false);
  });

  it("rejects malformed IDs", () => {
    expect(ProjectId.safeParse("nope").success).toBe(false);
    expect(ProjectId.safeParse("seg_01J8ZQ4K2M9T3X7YB6N0PWABCD").success).toBe(false);
    expect(ProjectId.safeParse("prj_short").success).toBe(false);
    expect(UploadSessionId.safeParse(sampleId("upl", 3)).success).toBe(true);
  });

  it("idPrefix throws on unknown prefixes", () => {
    expect(() => idPrefix("zzz_SAMPLE000001")).toThrow(/Unknown ID prefix/);
  });

  it("ALL_ID_PREFIXES covers the documented entity set", () => {
    const set = new Set<string>(ALL_ID_PREFIXES);
    for (const p of ["prj", "ast", "seg", "sht", "spk", "trk", "clp", "cap", "sty", "op", "grp", "btc", "job", "fnd", "usr", "key", "upl"] as IdPrefix[]) {
      expect(set.has(p)).toBe(true);
    }
  });
});
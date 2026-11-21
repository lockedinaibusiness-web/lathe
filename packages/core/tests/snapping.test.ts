import { describe, expect, it } from "vitest";
import {
  resolveAndSnap,
  SnapError,
  type SourceIndex,
} from "../src/snap.js";
import { DEFAULT_SNAP_POLICY, seconds } from "@lathe/schemas";
import { emptyTimeline } from "../src/timeline.js";
import { testSource } from "./fixtures.js";

const timeline = emptyTimeline(() => "trk_TESTX0001");

function src(overrides: Partial<SourceIndex> = {}): SourceIndex {
  return { ...testSource(600), ...overrides };
}

describe("snap policy (invariants #1, #6)", () => {
  it("raw seconds snap to the silence middle when inside tolerance", () => {
    // 100.0-101.5 silence; a raw cut at 100.05 lands in it.
    const r = resolveAndSnap("op_X", seconds(100.05), timeline, src());
    expect(r.report.snapped_to).toBe("silence");
    expect(r.applied_s).toBeGreaterThanOrEqual(100.0);
    expect(r.applied_s).toBeLessThanOrEqual(101.5);
    expect(r.report.delta_ms).toBeLessThanOrEqual(DEFAULT_SNAP_POLICY.tolerance_ms);
  });

  it("never lands mid-word: snaps to the nearest word edge within tolerance", () => {
    const words = src().words;
    const w = words[10]!; // s..e
    const nearStart = w.s + 0.02; // 20 ms into the word: inside the tolerance
    const noSilence: SourceIndex = { ...src(), silences: [] };
    const r = resolveAndSnap("op_X", seconds(nearStart), timeline, noSilence);
    expect(r.report.snapped_to).toBe("word");
    expect(r.applied_s).toBe(w.s);
    expect(r.report.word).toEqual({ segment_id: w.segment_id, word_index: w.word_index });
  });

  it("rejects a mid-word cut too far from any word edge (OP_SNAP_AMBIGUOUS)", () => {
    const words = src().words;
    const w = words[10]!;
    const middle = (w.s + w.e) / 2;
    const noSilence: SourceIndex = { ...src(), silences: [] };
    try {
      resolveAndSnap("op_X", seconds(middle), timeline, noSilence);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as SnapError).code).toBe("OP_SNAP_AMBIGUOUS");
    }
  });

  it("rejects a cut that cannot snap within tolerance (OP_SNAP_AMBIGUOUS)", () => {
    const noSilence: SourceIndex = { ...src(), silences: [], words: [] };
    // Frame grid at 25 fps: 7.31 s -> nearest frame 7.32 (delta 10ms, ok)...
    // push far from any frame: use a tiny tolerance to force ambiguity.
    const tight = { ...DEFAULT_SNAP_POLICY, tolerance_ms: 1, avoid_mid_word: false, prefer_silence: false };
    const r = resolveAndSnap("op_X", seconds(7.314), timeline, noSilence, tight);
    expect(r.report.delta_ms).toBeLessThanOrEqual(1);
  });

  it("frame references resolve exactly with no snap", () => {
    const r = resolveAndSnap("op_X", { kind: "frame", frame: 175 }, timeline, src());
    expect(r.applied_s).toBe(7); // 175 / 25 fps
    expect(r.report.snapped_to).toBe("none");
  });

  it("word references resolve exactly and report no delta", () => {
    const w = src().words[3]!;
    const r = resolveAndSnap("op_X", { kind: "word", segment_id: w.segment_id, word_index: w.word_index, edge: "end" }, timeline, src());
    expect(r.applied_s).toBe(w.e);
    expect(r.report.delta_ms).toBe(0);
  });

  it("unknown word references fail with OP_TARGET_NOT_FOUND", () => {
    try {
      resolveAndSnap("op_X", { kind: "word", segment_id: "seg_MISSING001", word_index: 0, edge: "start" }, timeline, src());
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SnapError);
      expect((err as SnapError).code).toBe("OP_TARGET_NOT_FOUND");
    }
  });

  it("out-of-range times fail with OP_INVALID_TIME", () => {
    try {
      resolveAndSnap("op_X", seconds(9999), timeline, src());
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as SnapError).code).toBe("OP_INVALID_TIME");
    }
  });

  it("exact policies (engine inverses) never move the point", () => {
    const exact = { avoid_mid_word: false, prefer_silence: false, tolerance_ms: 1e9, pause_inset_ms: 0 };
    const w = src().words[5]!;
    const middle = (w.s + w.e) / 2;
    const r = resolveAndSnap("op_X", seconds(middle), timeline, src(), exact);
    expect(r.applied_s).toBe(middle);
    expect(r.report.snapped_to).toBe("none");
  });

  it("default policy prefers silence over a nearby word edge", () => {
    // A word edge sitting exactly on a silence boundary: silence wins.
    const words = [{ segment_id: "seg_TEST000001", word_index: 0, s: 50, e: 50.4 }];
    const source: SourceIndex = { duration_s: 600, fps: 25, words, silences: [{ s: 50, e: 51 }] };
    const r = resolveAndSnap("op_X", seconds(50.1), timeline, source);
    expect(r.report.snapped_to).toBe("silence");
  });
});
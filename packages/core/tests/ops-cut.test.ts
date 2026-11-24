import { describe, expect, it } from "vitest";
import { applyOperation, OpFailure } from "../src/ops.js";
import { clipAt, sequenceTimeline, testCtx, testSource } from "./fixtures.js";
import { timelinesEqual } from "../src/timeline.js";
import { applyOperations } from "../src/ops.js";
import { seconds } from "@lathe/schemas";
import type { Operation } from "@lathe/schemas";

const ctx = () => testCtx();

describe("split", () => {
  it("splits a clip at a snapped point and moves later captions right", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const c1 = clipIds[0]!;
    const op: Operation = {
      id: "op_SPLIT00001", type: "split", group_id: "grp_TEST000001", rationale: "split for pacing",
      target: { clip_id: c1, at: seconds(5) },
      params: {},
    };
    const r = applyOperation(timeline, op, ctx());
    const newClip = clipAt(r.timeline, r.created.clip_ids[0]!);
    expect(newClip.start_s).toBe(5);
    expect(newClip.source_in_s).toBe(5);
    expect(clipAt(r.timeline, c1).source_out_s).toBe(5);
    expect(r.snaps[0]?.op_id).toBe(op.id);
  });

  it("rejects a split outside the clip", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const op: Operation = {
      id: "op_SPLIT00002", type: "split", group_id: "grp_TEST000001", rationale: "bad split",
      target: { clip_id: clipIds[0]!, at: seconds(15) },
      params: {},
    };
    expect(() => applyOperation(timeline, op, ctx())).toThrow(OpFailure);
  });
});

describe("trim (ripple by default)", () => {
  it("trim in ripples downstream clips left by the delta", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const op: Operation = {
      id: "op_TRIM000001", type: "trim", group_id: "grp_TEST000001", rationale: "tighten open",
      target: { clip_id: clipIds[1]! },
      params: { side: "in", in: { kind: "clip", clip_id: clipIds[1]!, edge: "in", offset_s: 2 }, ripple: true },
    };
    const r = applyOperation(timeline, op, ctx());
    expect(clipAt(r.timeline, clipIds[1]!).start_s).toBe(12);
    expect(clipAt(r.timeline, clipIds[2]!).start_s).toBe(18); // 20 - 2
    expect(clipAt(r.timeline, clipIds[0]!).start_s).toBe(0);
  });

  it("ripple: false leaves the gap downstream untouched", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const op: Operation = {
      id: "op_TRIM000002", type: "trim", group_id: "grp_TEST000001", rationale: "local trim",
      target: { clip_id: clipIds[1]! },
      params: { side: "in", in: { kind: "clip", clip_id: clipIds[1]!, edge: "in", offset_s: 2 }, ripple: false },
    };
    const r = applyOperation(timeline, op, ctx());
    expect(clipAt(r.timeline, clipIds[2]!).start_s).toBe(20); // untouched
  });

  it("rejects a trim shorter than one frame", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const op: Operation = {
      id: "op_TRIM000003", type: "trim", group_id: "grp_TEST000001", rationale: "too small",
      target: { clip_id: clipIds[1]! },
      params: { side: "out", out: { kind: "clip", clip_id: clipIds[1]!, edge: "in", offset_s: 0.01 }, ripple: true },
    };
    expect(() => applyOperation(timeline, op, ctx())).toThrow(/one frame/);
  });

  it("rejects a trim with no bounds", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const op: Operation = {
      id: "op_TRIM000004", type: "trim", group_id: "grp_TEST000001", rationale: "no bounds",
      target: { clip_id: clipIds[1]! },
      params: { side: "in", ripple: true },
    };
    expect(() => applyOperation(timeline, op, ctx())).toThrow(OpFailure);
  });
});

describe("delete and ripple_delete", () => {
  it("ripple_delete closes the gap", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const op: Operation = {
      id: "op_DEL00000001", type: "ripple_delete", group_id: "grp_TEST000001", rationale: "cut tangent",
      target: { clip_id: clipIds[1]! },
      params: { ripple: true },
    };
    const r = applyOperation(timeline, op, ctx());
    expect(r.timeline.clips[clipIds[1]!]).toBeUndefined();
    expect(clipAt(r.timeline, clipIds[2]!).start_s).toBe(10); // 20 - 10
  });

  it("delete with ripple: false leaves the gap", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const op: Operation = {
      id: "op_DEL00000002", type: "delete", group_id: "grp_TEST000001", rationale: "remove flop",
      target: { clip_id: clipIds[1]! },
      params: { ripple: false },
    };
    const r = applyOperation(timeline, op, ctx());
    expect(clipAt(r.timeline, clipIds[2]!).start_s).toBe(20); // untouched
  });

  it("restores clip + attached captions via its inverse", () => {
    const { timeline, trackId, clipIds } = sequenceTimeline();
    const c3 = clipIds[2]!;
    timeline.captions["cap_SEQ0000001"] = { id: "cap_SEQ0000001", track_id: trackId, clip_id: c3, start_s: 21, end_s: 23, text: "keep" };
    const del: Operation = {
      id: "op_DEL00000003", type: "ripple_delete", group_id: "grp_TEST000001", rationale: "remove",
      target: { clip_id: c3 },
      params: { ripple: true },
    };
    const r = applyOperation(timeline, del, ctx());
    const restored = applyOperations(r.timeline, r.inverse, ctx()).timeline;
    expect(timelinesEqual(restored, timeline)).toBe(true);
  });
});

describe("reorder and set_speed", () => {
  it("reorder re-packs the track sequentially", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const op: Operation = {
      id: "op_REORDER001", type: "reorder", group_id: "grp_TEST000001", rationale: "move end to front",
      target: { clip_id: clipIds[2]! },
      params: { to_index: 0 },
    };
    const r = applyOperation(timeline, op, ctx());
    const track = r.timeline.tracks[0]!;
    expect(track.clip_ids[0]).toBe(clipIds[2]!);
    expect(clipAt(r.timeline, clipIds[2]!).start_s).toBe(0);
    expect(clipAt(r.timeline, clipIds[0]!).start_s).toBe(10);
  });

  it("set_speed ripples downstream by the duration delta", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const op: Operation = {
      id: "op_SPEED00001", type: "set_speed", group_id: "grp_TEST000001", rationale: "2x",
      target: { clip_id: clipIds[1]! },
      params: { speed: 2, preserve_pitch: true },
    };
    const r = applyOperation(timeline, op, ctx());
    expect(clipAt(r.timeline, clipIds[1]!).start_s).toBe(10);
    expect(clipAt(r.timeline, clipIds[2]!).start_s).toBe(15); // 20 - 5
  });
});

describe("restore_clip", () => {
  it("replaces an existing clip in place with the pre-image (engine inverse of mutating ops)", () => {
    const { timeline, trackId, clipIds } = sequenceTimeline();
    const clip = clipAt(timeline, clipIds[0]!);
    const mutated = { ...structuredClone(clip), source_out_s: 3, start_s: 99 };
    const withMutation = { ...timeline, clips: { ...timeline.clips, [clipIds[0]!]: mutated } };
    const op: Operation = {
      id: "op_RESTORE001", type: "restore_clip", group_id: "grp_TEST000001", rationale: "replace",
      target: { track_id: trackId },
      params: { clip: JSON.parse(JSON.stringify(clip)), captions: [], at_s: 0, ripple: true },
    };
    const r = applyOperation(withMutation, op, ctx());
    // Fields restored; track ORDER untouched (no ripple on the replace path).
    expect(clipAt(r.timeline, clipIds[0]!).source_out_s).toBe(10);
    expect(clipAt(r.timeline, clipIds[0]!).start_s).toBe(0);
    expect(r.timeline.tracks[0]!.clip_ids).toEqual([clipIds[0]!, clipIds[1]!, clipIds[2]!]);
  });
});

describe("source index bounds", () => {
  it("ops referencing unknown clips fail with a catalog code", () => {
    const { timeline } = sequenceTimeline();
    const op: Operation = {
      id: "op_MISSING001", type: "set_gain", group_id: "grp_TEST000001", rationale: "x",
      target: { clip_id: "clp_MISSING0001" },
      params: { gain_db: 0 },
    };
    try {
      applyOperation(timeline, op, ctx());
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OpFailure);
      expect((err as OpFailure).code).toBe("OP_TARGET_NOT_FOUND");
      expect((err as OpFailure).suggested_fix.length).toBeGreaterThan(10);
    }
  });

  it("applyOperation validates the raw operation shape", () => {
    const { timeline } = sequenceTimeline();
    const bad = { id: "op_RAW0000001", type: "set_gain", target: { clip_id: "x" }, params: { gain_db: 999 }, rationale: "r", group_id: "g" } as unknown as Operation;
    expect(() => applyOperation(timeline, bad, ctx())).toThrow(OpFailure);
  });
});

describe("testSource fixture", () => {
  it("plants words every 0.4 s from 1.0 s", () => {
    const s = testSource(600);
    expect(s.words[0]).toMatchObject({ s: 1.0, e: 1.3 });
    expect(s.silences).toHaveLength(3);
  });
});
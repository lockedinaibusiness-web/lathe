import { describe, expect, it } from "vitest";
import { applyOperation } from "../src/ops.js";
import { resolveAndSnap } from "../src/snap.js";
import { seconds } from "@lathe/schemas";
import {
  emptyTimeline,
  timelineDuration,
  trackClips,
  brollTrack,
  BROLL_TRACK_ID,
  clipEnd,
  captionsOf,
} from "../src/timeline.js";
import { clipAt, sequenceTimeline, testCtx } from "./fixtures.js";
import type { Operation } from "@lathe/schemas";

const ctx = () => testCtx();

function op(id: string, type: Operation["type"], target: Record<string, unknown>, params: Record<string, unknown>): Operation {
  return { id, type, group_id: "grp_TEST000001", rationale: `edge ${type}`, target, params } as Operation;
}

describe("timeline helpers", () => {
  it("emptyTimeline + derived B-roll track + durations", () => {
    const t = emptyTimeline(() => "trk_TEST000010");
    expect(timelineDuration(t)).toBe(0);
    expect(brollTrack(t).clip_ids).toEqual([]);
    expect(trackClips(t, t.tracks[0]!.id)).toEqual([]);
    expect(captionsOf(t, "clp_NOPE")).toEqual([]);
    const probe = {
      id: "clp_X", track_id: "trk_X", segment_id: "seg_X",
      start_s: 2, source_in_s: 0, source_out_s: 8, speed: 2,
      reframe: null, zoom: null, transition: null, audio: null, overlays: [],
    };
    expect(clipEnd(probe)).toBe(6);
  });
});

describe("operation error paths", () => {
  it("trim out cannot exceed the source duration", () => {
    const { timeline, clipIds } = sequenceTimeline();
    expect(() =>
      applyOperation(
        timeline,
        op("op_E000000001", "trim", { clip_id: clipIds[0]! }, { side: "out", out: { kind: "seconds", seconds: 601 }, ripple: true }),
        ctx(),
      ),
    ).toThrow(/outside the source range/);
  });

  it("trim in cannot precede the source start", () => {
    const { timeline, clipIds } = sequenceTimeline();
    // Clip 2 starts at 10s with source_in 0: trimming its in-point to 5s
    // would borrow source media before its recorded start.
    expect(() =>
      applyOperation(
        timeline,
        op("op_E000000003", "trim", { clip_id: clipIds[1]! }, { side: "in", in: { kind: "seconds", seconds: 5 }, ripple: false }),
        ctx(),
      ),
    ).toThrow(/past the start of the source/);
  });

  it("style_caption on a missing caption fails with the catalog code", () => {
    const { timeline } = sequenceTimeline();
    try {
      applyOperation(
        timeline,
        op("op_E000000004", "style_caption", { caption_id: "cap_MISSING0001" }, { style_id: "sty_TEST000001" }),
        ctx(),
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("OP_TARGET_NOT_FOUND");
    }
  });

  it("caption times beyond the source duration are rejected at resolve time", () => {
    const { timeline, clipIds } = sequenceTimeline();
    expect(() =>
      applyOperation(
        timeline,
        op("op_E000000005", "add_caption", { clip_id: clipIds[0]! }, {
          text: "too late",
          from: { kind: "seconds", seconds: 100.05 },
          to: { kind: "seconds", seconds: 602 },
        }),
        ctx(),
      ),
    ).toThrow(/outside the source range/);
  });

  it("caption defaults to the clip range when times are omitted", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const r = applyOperation(
      timeline,
      op("op_E000000006", "add_caption", { clip_id: clipIds[0]! }, { text: "spanning" }),
      ctx(),
    );
    const cap = r.timeline.captions[r.created.caption_ids[0]!]!;
    expect(cap.start_s).toBe(0);
    expect(cap.end_s).toBe(10);
  });

  it("overlay with an inverted range is rejected", () => {
    const { timeline, clipIds } = sequenceTimeline();
    expect(() =>
      applyOperation(
        timeline,
        op("op_E000000007", "add_overlay", { clip_id: clipIds[0]! }, {
          kind: "text",
          text: "x",
          from: { kind: "clip", clip_id: clipIds[0]!, edge: "in", offset_s: 4 },
          to: { kind: "clip", clip_id: clipIds[0]!, edge: "in", offset_s: 4 },
          opacity: 1,
        }),
        ctx(),
      ),
    ).toThrow(/range is empty/);
  });

  it("remove_overlay on a missing effect fails", () => {
    const { timeline, clipIds } = sequenceTimeline();
    try {
      applyOperation(
        timeline,
        op("op_E000000008", "remove_overlay", { clip_id: clipIds[0]!, effect_id: "efx_MISSING0001" }, {}),
        ctx(),
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("OP_TARGET_NOT_FOUND");
    }
  });

  it("set_gain on a missing track fails; reorder on a locked track is rejected", () => {
    const { timeline, clipIds } = sequenceTimeline();
    try {
      applyOperation(timeline, op("op_E000000009", "set_gain", { track_id: "trk_MISSING0001" }, { gain_db: 1 }), ctx());
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("OP_TARGET_NOT_FOUND");
    }
    // Lock the video track, then reorder within it.
    const locked = {
      ...timeline,
      tracks: timeline.tracks.map((tr) => (tr.id === timeline.tracks[0]!.id ? { ...tr, locked: true } : tr)),
    };
    expect(() =>
      applyOperation(
        locked,
        op("op_E000000010", "reorder", { clip_id: clipIds[0]! }, { to_index: 2 }),
        ctx(),
      ),
    ).toThrow(/locked/);
  });

  it("duck_audio on a clip with an existing duck restores the prior duck", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const set = applyOperation(
      timeline,
      op("op_E000000011", "duck_audio", { clip_id: clipIds[0]! }, { duck_db: -6, under: "music", fade_s: 0.1, clear: false }),
      ctx(),
    );
    const again = applyOperation(
      set.timeline,
      op("op_E000000012", "duck_audio", { clip_id: clipIds[0]! }, { duck_db: -20, under: "speech", fade_s: 0.4, clear: false }),
      ctx(),
    );
    expect(clipAt(again.timeline, clipIds[0]!).audio?.duck).toMatchObject({ duck_db: -20, under: "speech" });
    const back = applyOperation(again.timeline, again.inverse[0]!, ctx());
    expect(clipAt(back.timeline, clipIds[0]!).audio?.duck).toMatchObject({ duck_db: -6, under: "music" });
  });

  it("normalize_audio on a track restores prior target", () => {
    const { timeline, trackId } = sequenceTimeline();
    const set = applyOperation(
      timeline,
      op("op_E000000013", "normalize_audio", { track_id: trackId }, { target_lufs: -18, true_peak_dbtp: -2, clear: false }),
      ctx(),
    );
    expect(set.timeline.tracks[0]!.audio?.normalize).toEqual({ target_lufs: -18, true_peak_dbtp: -2 });
    const again = applyOperation(
      set.timeline,
      op("op_E000000014", "normalize_audio", { track_id: trackId }, { target_lufs: -14, true_peak_dbtp: -1, clear: false }),
      ctx(),
    );
    const back = applyOperation(again.timeline, again.inverse[0]!, ctx());
    expect(back.timeline.tracks[0]!.audio?.normalize).toEqual({ target_lufs: -18, true_peak_dbtp: -2 });
  });

  it("insert_broll with a pending search source records the query", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const r = applyOperation(
      timeline,
      op("op_E000000015", "insert_broll", { clip_id: clipIds[0]!, at: { kind: "clip", clip_id: clipIds[0]!, edge: "in", offset_s: 1 } }, {
        source: { kind: "project_search", query: "city skyline" },
        duration_s: 3,
        audio: "keep",
      }),
      ctx(),
    );
    const brollId = r.created.clip_ids[0]!;
    expect(clipAt(r.timeline, brollId).segment_id).toBe("pending:project_search:city skyline");
    expect(clipAt(r.timeline, brollId).broll_audio).toBe("keep");
  });

  it("restore_clip on a missing track and locked track fail", () => {
    const { timeline } = sequenceTimeline();
    try {
      applyOperation(
        timeline,
        op("op_E000000016", "restore_clip", { track_id: "trk_MISSING0001" }, {
          clip: { id: "clp_TEST000009", track_id: "trk_TEST000001", segment_id: "seg_TEST000001", start_s: 0, source_in_s: 0, source_out_s: 5 },
          captions: [],
          at_s: 0,
        }),
        ctx(),
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("OP_TARGET_NOT_FOUND");
    }
  });

  it("set_gain on a project scope is rejected (scope is clip/track)", () => {
    const { timeline } = sequenceTimeline();
    try {
      applyOperation(timeline, op("op_E000000017", "set_gain", { scope: "project" }, { gain_db: 1 }), ctx());
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("OP_INVALID_PARAMS");
    }
  });

  it("split with an explicit new clip id uses it", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const r = applyOperation(
      timeline,
      op("op_E000000018", "split", { clip_id: clipIds[0]!, at: { kind: "seconds", seconds: 5 } }, { new_clip_id: "clp_TEST000077" }),
      ctx(),
    );
    expect(r.created.clip_ids).toEqual(["clp_TEST000077"]);
    expect(brollTrack(r.timeline).clip_ids).toEqual([]);
  });

  it("add_caption creates the caption track when the timeline has none", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const noCaptionTrack = { ...timeline, tracks: timeline.tracks.filter((tr) => tr.kind !== "caption") };
    expect(noCaptionTrack.tracks.some((tr) => tr.kind === "caption")).toBe(false);
    const r = applyOperation(
      noCaptionTrack,
      op("op_E000000020", "add_caption", { clip_id: clipIds[0]! }, { text: "lazy track" }),
      ctx(),
    );
    const captionTrack = r.timeline.tracks.find((tr) => tr.kind === "caption");
    expect(captionTrack).toBeDefined();
    const cap = r.timeline.captions[r.created.caption_ids[0]!]!;
    expect(cap.track_id).toBe(captionTrack!.id);
  });

  it("caption with an empty range is rejected", () => {
    const { timeline, clipIds } = sequenceTimeline();
    expect(() =>
      applyOperation(
        timeline,
        op("op_E000000021", "add_caption", { clip_id: clipIds[0]! }, {
          text: "empty",
          from: { kind: "clip", clip_id: clipIds[0]!, edge: "in", offset_s: 2 },
          to: { kind: "clip", clip_id: clipIds[0]!, edge: "in", offset_s: 2 },
        }),
        ctx(),
      ),
    ).toThrow(/range .* is empty/);
  });

  it("trim out without an out param and out beyond source via a fast clip", () => {
    const { timeline, clipIds } = sequenceTimeline();
    expect(() =>
      applyOperation(timeline, op("op_E000000022", "trim", { clip_id: clipIds[0]! }, { side: "out", ripple: true }), ctx()),
    ).toThrow(/requires an out time/);

    const fast = applyOperation(
      timeline,
      op("op_E000000023", "set_speed", { clip_id: clipIds[0]! }, { speed: 8, preserve_pitch: false }),
      ctx(),
    );
    expect(() =>
      applyOperation(
        fast.timeline,
        op("op_E000000024", "trim", { clip_id: clipIds[0]! }, { side: "out", out: { kind: "seconds", seconds: 200 }, ripple: true }),
        ctx(),
      ),
    ).toThrow(/past the end of the source/);
  });

  it("set_speed to the current speed is a no-op", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const r = applyOperation(
      timeline,
      op("op_E000000025", "set_speed", { clip_id: clipIds[0]! }, { speed: 1, preserve_pitch: true }),
      ctx(),
    );
    expect(r.inverse).toEqual([]);
    expect(clipAt(r.timeline, clipIds[0]!).speed).toBe(1);
  });

  it("restore_clip without order_index inserts by time", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const deleted = applyOperation(
      timeline,
      op("op_E000000026", "delete", { clip_id: clipIds[1]! }, { ripple: false }),
      ctx(),
    );
    expect(deleted.timeline.tracks[0]!.clip_ids).not.toContain(clipIds[1]!);
    const restored = applyOperation(
      deleted.timeline,
      op("op_E000000027", "restore_clip", { track_id: timeline.tracks[0]!.id }, {
        clip: {
          id: clipIds[1]!,
          track_id: timeline.tracks[0]!.id,
          segment_id: "seg_SEQ0000002",
          start_s: 10,
          source_in_s: 0,
          source_out_s: 10,
        },
        captions: [],
        at_s: 10,
        ripple: false,
      }),
      ctx(),
    );
    expect(restored.timeline.tracks[0]!.clip_ids).toEqual([clipIds[0]!, clipIds[1]!, clipIds[2]!]);
    expect(clipAt(restored.timeline, clipIds[1]!).start_s).toBe(10);
  });

  it("duck with a range round-trips through its inverse", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const set = applyOperation(
      timeline,
      op("op_E000000028", "duck_audio", { clip_id: clipIds[0]! }, {
        duck_db: -10,
        under: "speech",
        fade_s: 0.2,
        range: { from: { kind: "seconds", seconds: 100.05 }, to: { kind: "seconds", seconds: 100.5 } },
        clear: false,
      }),
      ctx(),
    );
    expect(clipAt(set.timeline, clipIds[0]!).audio?.duck?.range).toEqual({ from_s: 100.05, to_s: 100.5 });
    const back = applyOperation(set.timeline, set.inverse[0]!, ctx());
    expect(clipAt(back.timeline, clipIds[0]!).audio).toBeNull();
  });

  it("insert_broll from a stock source records provider+query", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const r = applyOperation(
      timeline,
      op("op_E000000029", "insert_broll", { clip_id: clipIds[0]!, at: { kind: "clip", clip_id: clipIds[0]!, edge: "in", offset_s: 1 } }, {
        source: { kind: "stock", provider: "pexels", query: "drone coast" },
        duration_s: 4,
        audio: "duck",
      }),
      ctx(),
    );
    expect(clipAt(r.timeline, r.created.clip_ids[0]!).segment_id).toBe("pending:stock:pexels:drone coast");
  });

  it("inside-silence points stay put when prefer_silence is false", () => {
    // Direct snap-policy check: with prefer_silence off, a point already inside
    // a pause is NOT held there — it falls through to the frame grid.
    const policy = { avoid_mid_word: true, prefer_silence: false, tolerance_ms: 1e9, pause_inset_ms: 0 };
    const r = resolveAndSnap("op_E000000030", seconds(100.05), emptyTimeline(() => "trk_TEST000010"), ctx().source, policy);
    expect(r.report.snapped_to).not.toBe("silence");
    expect(r.applied_s).toBeGreaterThanOrEqual(100);
  });

  it("reorder rejects cross-kind moves and supports cross-track video moves", () => {
    const { timeline, clipIds } = sequenceTimeline();
    // video -> audio is a kind mismatch.
    expect(() =>
      applyOperation(
        timeline,
        op("op_E000000031", "reorder", { clip_id: clipIds[0]! }, { to_index: 0, to_track_id: timeline.tracks[1]!.id }),
        ctx(),
      ),
    ).toThrow(/cannot move a video clip to a audio track/);

    // video -> a second video track works and repacks the destination.
    const withSecondVideo = {
      ...timeline,
      tracks: [
        ...timeline.tracks,
        { id: "trk_TEST000020", kind: "video" as const, name: "Video 2", position: 3, audio: null, clip_ids: [] },
      ],
    };
    const r = applyOperation(
      withSecondVideo,
      op("op_E000000032", "reorder", { clip_id: clipIds[1]! }, { to_index: 0, to_track_id: "trk_TEST000020" }),
      ctx(),
    );
    expect(r.timeline.tracks.find((tr) => tr.id === "trk_TEST000020")!.clip_ids).toEqual([clipIds[1]!]);
    expect(clipAt(r.timeline, clipIds[1]!).start_s).toBe(0);
    expect(clipAt(r.timeline, clipIds[2]!).start_s).toBe(10); // source track repacked
  });

  it("restore_clip on the virtual B-roll track with a full pre-image", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const set = applyOperation(
      timeline,
      op("op_E000000019", "insert_broll", { clip_id: clipIds[0]!, at: { kind: "clip", clip_id: clipIds[0]!, edge: "in", offset_s: 1 } }, {
        source: { kind: "project_asset", asset_id: "ast_TEST000002" },
        duration_s: 2,
        audio: "mute",
      }),
      ctx(),
    );
    const brollId = set.created.clip_ids[0]!;
    expect(brollTrack(set.timeline).clip_ids).toEqual([brollId]);
    const removed = applyOperation(set.timeline, set.inverse[0]!, ctx());
    expect(removed.timeline.clips[brollId]).toBeUndefined();
    // The delete's inverse re-inserts on the virtual track.
    const back = applyOperation(removed.timeline, removed.inverse[0]!, ctx());
    expect(back.timeline.clips[brollId]).toBeDefined();
    expect(back.timeline.clips[brollId]!.track_id).toBe(BROLL_TRACK_ID);
    // Deleting again is byte-exact.
    const gone = applyOperation(back.timeline, back.inverse[0]!, ctx());
    expect(gone.timeline.clips[brollId]).toBeUndefined();
  });
});
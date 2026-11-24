import { describe, expect, it } from "vitest";
import { applyOperation } from "../src/ops.js";
import { brollTrack } from "../src/timeline.js";
import { clipAt, sequenceTimeline, testCtx } from "./fixtures.js";
import type { Operation } from "@lathe/schemas";

const brollTrackView = brollTrack;

const ctx = () => testCtx();

describe("reframe / zoom / transition", () => {
  it("sets absolute reframe state and restores it exactly", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const c1 = clipIds[0]!;
    const set: Operation = {
      id: "op_REF0000001", type: "reframe", group_id: "grp_TEST000001", rationale: "vertical",
      target: { clip_id: c1 },
      params: { aspect: "9:16", mode: "subject", smoothing_s: 0.5, zoom: 1.05, reset: false },
    };
    const r = applyOperation(timeline, set, ctx());
    expect(clipAt(r.timeline, c1).reframe).toMatchObject({ aspect: "9:16", zoom: 1.05 });
    const back = applyOperation(r.timeline, r.inverse[0]!, ctx());
    expect(clipAt(back.timeline, c1).reframe).toBeNull();
  });

  it("restores a prior reframe value (not null)", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const c1 = clipIds[0]!;
    const first = applyOperation(
      timeline,
      { id: "op_REF0000002", type: "reframe", group_id: "grp_TEST000001", rationale: "square", target: { clip_id: c1 }, params: { aspect: "1:1", mode: "center", smoothing_s: 0.2, zoom: 1, reset: false } },
      ctx(),
    );
    const second = applyOperation(
      first.timeline,
      { id: "op_REF0000003", type: "reframe", group_id: "grp_TEST000001", rationale: "vertical", target: { clip_id: c1 }, params: { aspect: "9:16", mode: "subject", smoothing_s: 0.5, zoom: 1, reset: false } },
      ctx(),
    );
    const back = applyOperation(second.timeline, second.inverse[0]!, ctx());
    expect(clipAt(back.timeline, c1).reframe).toMatchObject({ aspect: "1:1", smoothing_s: 0.2 });
  });

  it("custom reframe requires dimensions", () => {
    const { timeline, clipIds } = sequenceTimeline();
    expect(() =>
      applyOperation(
        timeline,
        { id: "op_REF0000004", type: "reframe", group_id: "grp_TEST000001", rationale: "bad", target: { clip_id: clipIds[0]! }, params: { aspect: "custom", mode: "manual", smoothing_s: 0.5, zoom: 1, reset: false } },
        ctx(),
      ),
    ).toThrow(/custom_w/);
  });

  it("zoom stores resolved range times and restores", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const c1 = clipIds[0]!;
    const set: Operation = {
      id: "op_ZOOM000001", type: "zoom", group_id: "grp_TEST000001", rationale: "punch in",
      target: { clip_id: c1 },
      params: { scale: 1.2, ease: "ease_in_out", from: { kind: "clip", clip_id: c1, edge: "in", offset_s: 2 }, to: { kind: "clip", clip_id: c1, edge: "in", offset_s: 5 }, reset: false },
    };
    const r = applyOperation(timeline, set, ctx());
    expect(clipAt(r.timeline, c1).zoom).toMatchObject({ scale: 1.2, from_s: 2, to_s: 5 });
    const back = applyOperation(r.timeline, r.inverse[0]!, ctx());
    expect(clipAt(back.timeline, c1).zoom).toBeNull();
  });

  it("transition kind 'none' clears the transition", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const c1 = clipIds[0]!;
    const set = applyOperation(
      timeline,
      { id: "op_TRANS00001", type: "add_transition", group_id: "grp_TEST000001", rationale: "fade", target: { clip_id: c1 }, params: { kind: "crossfade", duration_s: 0.5 } },
      ctx(),
    );
    expect(clipAt(set.timeline, c1).transition).toEqual({ kind: "crossfade", duration_s: 0.5 });
    const cleared = applyOperation(
      set.timeline,
      { id: "op_TRANS00002", type: "add_transition", group_id: "grp_TEST000001", rationale: "remove fade", target: { clip_id: c1 }, params: { kind: "none", duration_s: 0 } },
      ctx(),
    );
    expect(clipAt(cleared.timeline, c1).transition).toBeNull();
    // Inverse restores the crossfade.
    const back = applyOperation(cleared.timeline, cleared.inverse[0]!, ctx());
    expect(clipAt(back.timeline, c1).transition).toEqual({ kind: "crossfade", duration_s: 0.5 });
  });
});

describe("captions", () => {
  it("adds a caption on a lazily created caption track and removes it", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const set = applyOperation(
      timeline,
      { id: "op_CAP0000001", type: "add_caption", group_id: "grp_TEST000001", rationale: "caption the hook", target: { clip_id: clipIds[0]! }, params: { text: "this is the hook", from: { kind: "clip", clip_id: clipIds[0]!, edge: "in", offset_s: 1 }, to: { kind: "clip", clip_id: clipIds[0]!, edge: "in", offset_s: 4 } } },
      ctx(),
    );
    const capId = set.created.caption_ids[0]!;
    const captionTrack = set.timeline.tracks.find((t) => t.kind === "caption");
    expect(captionTrack).toBeDefined();
    const cap = set.timeline.captions[capId];
    expect(cap).toMatchObject({ text: "this is the hook", start_s: 1, end_s: 4, track_id: captionTrack!.id });

    const removed = applyOperation(set.timeline, set.inverse[0]!, ctx());
    expect(removed.timeline.captions[capId]).toBeUndefined();
    // The inverse of the removal restores it exactly.
    const back = applyOperation(removed.timeline, removed.inverse[0]!, ctx());
    expect(back.timeline.captions[capId]).toEqual(cap);
  });

  it("style_caption sets and restores prior values, incl. explicit nulls", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const withCap = applyOperation(
      timeline,
      { id: "op_CAP0000002", type: "add_caption", group_id: "grp_TEST000001", rationale: "cap", target: { clip_id: clipIds[0]! }, params: { text: "styled" } },
      ctx(),
    );
    const capId = withCap.created.caption_ids[0]!;
    const styled = applyOperation(
      withCap.timeline,
      { id: "op_STYLE00001", type: "style_caption", group_id: "grp_TEST000001", rationale: "brand", target: { caption_id: capId }, params: { style_id: "sty_TEST000001", overrides: { max_lines: 2 } } },
      ctx(),
    );
    expect(styled.timeline.captions[capId]).toMatchObject({ style_id: "sty_TEST000001", overrides: { max_lines: 2 } });
    const back = applyOperation(styled.timeline, styled.inverse[0]!, ctx());
    expect(back.timeline.captions[capId]?.style_id).toBeUndefined();
    expect(back.timeline.captions[capId]?.overrides).toBeUndefined();
  });

  it("rejects a caption with an empty range", () => {
    const { timeline, clipIds } = sequenceTimeline();
    expect(() =>
      applyOperation(
        timeline,
        { id: "op_CAP0000003", type: "add_caption", group_id: "grp_TEST000001", rationale: "bad", target: { clip_id: clipIds[0]! }, params: { text: "x", from: { kind: "seconds", seconds: 5 }, to: { kind: "seconds", seconds: 5 } } },
        ctx(),
      ),
    ).toThrow(/empty/);
  });
});

describe("overlays", () => {
  it("adds and removes an overlay effect", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const set = applyOperation(
      timeline,
      { id: "op_OVL0000001", type: "add_overlay", group_id: "grp_TEST000001", rationale: "logo", target: { clip_id: clipIds[0]! }, params: { kind: "logo", asset_id: "ast_TEST000001", from: { kind: "clip", clip_id: clipIds[0]!, edge: "in", offset_s: 1 }, to: { kind: "clip", clip_id: clipIds[0]!, edge: "in", offset_s: 4 }, opacity: 0.8 } },
      ctx(),
    );
    const fx = clipAt(set.timeline, clipIds[0]!).overlays;
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ kind: "logo", from_s: 1, to_s: 4, opacity: 0.8 });
    const removed = applyOperation(set.timeline, set.inverse[0]!, ctx());
    expect(clipAt(removed.timeline, clipIds[0]!).overlays).toHaveLength(0);
    const back = applyOperation(removed.timeline, removed.inverse[0]!, ctx());
    expect(clipAt(back.timeline, clipIds[0]!).overlays[0]).toMatchObject({ kind: "logo", opacity: 0.8 });
  });

  it("requires an asset for image/video/logo overlays", () => {
    const { timeline, clipIds } = sequenceTimeline();
    expect(() =>
      applyOperation(
        timeline,
        { id: "op_OVL0000002", type: "add_overlay", group_id: "grp_TEST000001", rationale: "bad", target: { clip_id: clipIds[0]! }, params: { kind: "logo", from: { kind: "seconds", seconds: 1 }, to: { kind: "seconds", seconds: 2 }, opacity: 1 } },
        ctx(),
      ),
    ).toThrow(/asset_id/);
  });
});

describe("audio", () => {
  it("set_gain writes absolute state and restores prior value", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const set = applyOperation(
      timeline,
      { id: "op_GAIN000001", type: "set_gain", group_id: "grp_TEST000001", rationale: "louder", target: { clip_id: clipIds[0]! }, params: { gain_db: 3 } },
      ctx(),
    );
    expect(clipAt(set.timeline, clipIds[0]!).audio).toEqual({ gain_db: 3 });
    const back = applyOperation(set.timeline, set.inverse[0]!, ctx());
    expect(clipAt(back.timeline, clipIds[0]!).audio).toBeNull();
  });

  it("duck_audio targets a track and clears via clear flag", () => {
    const { timeline, trackId } = sequenceTimeline();
    const set = applyOperation(
      timeline,
      { id: "op_DUCK000001", type: "duck_audio", group_id: "grp_TEST000001", rationale: "duck music", target: { track_id: trackId }, params: { duck_db: -12, under: "speech", fade_s: 0.3, clear: false } },
      ctx(),
    );
    expect(set.timeline.tracks[0]!.audio).toEqual({ gain_db: 0, duck: { duck_db: -12, under: "speech", fade_s: 0.3 } });
    // The prior state was null (no audio settings); the inverse restores null.
    const cleared = applyOperation(set.timeline, set.inverse[0]!, ctx());
    expect(cleared.timeline.tracks[0]!.audio).toBeNull();
  });

  it("normalize_audio targets the project and restores", () => {
    const { timeline } = sequenceTimeline();
    const set = applyOperation(
      timeline,
      { id: "op_NORM000001", type: "normalize_audio", group_id: "grp_TEST000001", rationale: "level", target: { scope: "project" }, params: { target_lufs: -16, true_peak_dbtp: -1, clear: false } },
      ctx(),
    );
    expect(set.timeline.audio).toEqual({ gain_db: 0, normalize: { target_lufs: -16, true_peak_dbtp: -1 } });
    const back = applyOperation(set.timeline, set.inverse[0]!, ctx());
    expect(back.timeline.audio).toBeNull();
  });

  it("duck range must be non-empty", () => {
    const { timeline, clipIds } = sequenceTimeline();
    expect(() =>
      applyOperation(
        timeline,
        { id: "op_DUCK000002", type: "duck_audio", group_id: "grp_TEST000001", rationale: "bad", target: { clip_id: clipIds[0]! }, params: { duck_db: -6, under: "speech", fade_s: 0.2, range: { from: { kind: "seconds", seconds: 3 }, to: { kind: "seconds", seconds: 3 } }, clear: false } },
        ctx(),
      ),
    ).toThrow(/range is empty/);
  });
});

describe("insert_broll", () => {
  it("creates an isolated B-roll clip and removes it via inverse", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const set = applyOperation(
      timeline,
      { id: "op_BROLL00001", type: "insert_broll", group_id: "grp_TEST000001", rationale: "cover cutaway", target: { clip_id: clipIds[0]!, at: { kind: "clip", clip_id: clipIds[0]!, edge: "in", offset_s: 4 } }, params: { source: { kind: "project_asset", asset_id: "ast_TEST000002" }, duration_s: 3, audio: "duck" } },
      ctx(),
    );
    const brollId = set.created.clip_ids[0]!;
    expect(clipAt(set.timeline, brollId)).toMatchObject({ start_s: 4, is_broll: true, broll_audio: "duck" });
    // The B-roll track is VIRTUAL (derived), never stored in timeline.tracks.
    const brollTrack = brollTrackView(set.timeline);
    expect(brollTrack.clip_ids).toContain(brollId);
    expect(set.timeline.tracks.some((t) => t.name === "B-roll")).toBe(false);
    const removed = applyOperation(set.timeline, set.inverse[0]!, ctx());
    expect(removed.timeline.clips[brollId]).toBeUndefined();
    // The main track never rippled.
    expect(clipAt(removed.timeline, clipIds[2]!).start_s).toBe(20);
  });
});
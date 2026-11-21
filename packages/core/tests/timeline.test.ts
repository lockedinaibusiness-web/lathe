import { describe, expect, it } from "vitest";
import {
  emptyTimeline,
  clipDuration,
  clipSourceLength,
  clipEnd,
  timelineDuration,
  rippleTrack,
  repackTrack,
  captionsOf,
  timelinesEqual,
} from "../src/timeline.js";
import { makeClip, sequenceTimeline, clipAt, captionAt } from "./fixtures.js";

describe("timeline model", () => {
  it("creates the standard three tracks", () => {
    const t = emptyTimeline(() => "trk_TESTX0001");
    expect(t.tracks.map((tr) => tr.kind)).toEqual(["video", "audio", "caption"]);
    expect(timelineDuration(t)).toBe(0);
  });

  it("computes durations with speed", () => {
    const clip = makeClip({ id: "clp_X", track_id: "trk_X", segment_id: "seg_X", source_in_s: 5, source_out_s: 15, speed: 2 });
    expect(clipSourceLength(clip)).toBe(10);
    expect(clipDuration(clip)).toBe(5);
    expect(clipEnd(clip)).toBe(5);
  });

  it("sequenceTimeline lays clips end to end", () => {
    const { timeline, clipIds } = sequenceTimeline();
    expect(clipIds).toHaveLength(3);
    expect(timelineDuration(timeline)).toBe(30);
    expect(clipAt(timeline, clipIds[0]!).start_s).toBe(0);
    expect(clipAt(timeline, clipIds[2]!).start_s).toBe(20);
  });

  it("ripple shifts later clips and their captions, never the input", () => {
    const { timeline, trackId, clipIds } = sequenceTimeline();
    const k3 = clipIds[2]!;
    timeline.captions["cap_X"] = {
      id: "cap_X",
      track_id: trackId,
      clip_id: k3,
      start_s: 21,
      end_s: 24,
      text: "late",
    };
    const rippled = rippleTrack(timeline, trackId, 10, -3, clipIds[1]!);
    expect(clipAt(rippled, clipIds[0]!).start_s).toBe(0);
    expect(clipAt(rippled, clipIds[1]!).start_s).toBe(10);
    expect(clipAt(rippled, k3).start_s).toBe(17);
    expect(captionAt(rippled, "cap_X").start_s).toBe(18);
    // Immutability: the input timeline is untouched.
    expect(clipAt(timeline, k3).start_s).toBe(20);
  });

  it("repack re-lays a track sequentially and moves captions", () => {
    const { timeline, trackId, clipIds } = sequenceTimeline();
    const k2 = clipIds[1]!;
    clipAt(timeline, k2).start_s = 40;
    timeline.captions["cap_Y"] = {
      id: "cap_Y",
      track_id: trackId,
      clip_id: k2,
      start_s: 41,
      end_s: 44,
      text: "moved",
    };
    const { timeline: packed, deltas } = repackTrack(timeline, trackId);
    expect(clipAt(packed, clipIds[0]!).start_s).toBe(0);
    expect(clipAt(packed, k2).start_s).toBe(10);
    expect(deltas[k2]).toBe(-30);
    expect(captionAt(packed, "cap_Y").start_s).toBe(11);
    expect(captionAt(packed, "cap_Y").end_s).toBe(14);
  });

  it("captionsOf returns captions in timeline order", () => {
    const { timeline, clipIds } = sequenceTimeline();
    timeline.captions["cap_A"] = { id: "cap_A", track_id: "trk", clip_id: clipIds[0]!, start_s: 5, end_s: 6, text: "b" };
    timeline.captions["cap_B"] = { id: "cap_B", track_id: "trk", clip_id: clipIds[0]!, start_s: 1, end_s: 2, text: "a" };
    expect(captionsOf(timeline, clipIds[0]!).map((c) => c.id)).toEqual(["cap_B", "cap_A"]);
  });

  it("timelinesEqual is key-order proof", () => {
    const { timeline } = sequenceTimeline();
    const shuffled = { audio: timeline.audio, captions: timeline.captions, clips: timeline.clips, tracks: timeline.tracks, version: timeline.version };
    expect(timelinesEqual(timeline, shuffled)).toBe(true);
    expect(timelinesEqual(timeline, { ...timeline, version: 99 })).toBe(false);
  });
});
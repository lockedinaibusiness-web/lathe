import { describe, expect, it } from "vitest";
import { applyBatch } from "../src/batch.js";
import type { Operation } from "@lathe/schemas";
import { stableStringify } from "../src/timeline.js";
import { clipAt, sequenceTimeline, testCtx, makeClip, makeTrack } from "./fixtures.js";

const ctx = () => testCtx();

function op(id: string, type: Operation["type"], target: Record<string, unknown>, params: Record<string, unknown>): Operation {
  return { id, type, group_id: "grp_TEST000001", rationale: `batch ${type}`, target, params } as Operation;
}

describe("atomic batches (invariant #3)", () => {
  it("applies a valid batch and bumps the version once", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const out = applyBatch(
      {
        timeline,
        operations: [
          op("op_B000000001", "set_gain", { clip_id: clipIds[0]! }, { gain_db: 3 }),
          op("op_B000000002", "reframe", { clip_id: clipIds[1]! }, { aspect: "1:1", mode: "center", smoothing_s: 0.1, zoom: 1, reset: false }),
        ],
        base_version: 1,
      },
      ctx(),
    );
    expect(out.applied).toBe(true);
    expect(out.results).toHaveLength(2);
    expect(out.results.every((r) => r.ok)).toBe(true);
    expect(out.previous_version).toBe(1);
    expect(out.new_version).toBe(2);
    expect(clipAt(out.timeline, clipIds[0]!).audio).toEqual({ gain_db: 3 });
    // The input timeline is untouched (immutability).
    expect(clipAt(timeline, clipIds[0]!).audio).toBeNull();
    expect(timeline.version).toBe(1);
  });

  it("rejects the WHOLE batch when one operation fails (no partial application)", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const before = JSON.stringify(timeline);
    const out = applyBatch(
      {
        timeline,
        operations: [
          op("op_B000000003", "set_gain", { clip_id: clipIds[0]! }, { gain_db: 3 }),
          op("op_B000000004", "set_gain", { clip_id: "clp_MISSING0001" }, { gain_db: 3 }),
          op("op_B000000005", "reframe", { clip_id: clipIds[1]! }, { aspect: "9:16", mode: "subject", smoothing_s: 0.1, zoom: 1, reset: false }),
        ],
        base_version: 1,
      },
      ctx(),
    );
    expect(out.applied).toBe(false);
    expect(out.results[0]?.ok).toBe(true); // simulated per-op results reported
    expect(out.results[1]?.ok).toBe(false);
    expect(out.results[1]?.error?.code).toBe("OP_TARGET_NOT_FOUND");
    expect(out.results[1]?.error?.suggested_fix).toBeTruthy();
    // Nothing was persisted: the outcome's timeline is the unchanged input.
    expect(JSON.stringify(timeline)).toBe(before);
    expect(JSON.stringify(out.timeline)).toBe(before);
    expect(out.inverse).toEqual([]);
  });

  it("dry_run validates without persisting", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const out = applyBatch(
      {
        timeline,
        operations: [op("op_B000000006", "set_gain", { clip_id: clipIds[0]! }, { gain_db: -2 })],
        base_version: 1,
        dry_run: true,
      },
      ctx(),
    );
    expect(out.applied).toBe(false);
    expect(out.results[0]?.ok).toBe(true);
    expect(out.summary).toContain("Dry run");
  });

  it("rejects a stale base_version (optimistic concurrency)", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const out = applyBatch(
      {
        timeline,
        operations: [op("op_B000000007", "set_gain", { clip_id: clipIds[0]! }, { gain_db: 1 })],
        base_version: 99,
      },
      ctx(),
    );
    expect(out.applied).toBe(false);
    expect(out.conflicts[0]?.code).toBe("VERSION_CONFLICT");
  });

  it("enforces the 500-operation cap", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const many = Array.from({ length: 501 }, (_, i) =>
      op(`op_CAP${String(i).padStart(7, "0")}`, "set_gain", { clip_id: clipIds[0]! }, { gain_db: 0 }),
    );
    const out = applyBatch({ timeline, operations: many, base_version: 1 }, ctx());
    expect(out.applied).toBe(false);
    expect(out.conflicts[0]?.code).toBe("BATCH_TOO_LARGE");

    // Exactly 500 is accepted.
    const exactly = Array.from({ length: 500 }, (_, i) =>
      op(`op_OK${String(i).padStart(8, "0")}`, "set_gain", { clip_id: clipIds[0]! }, { gain_db: 0 }),
    );
    const ok = applyBatch({ timeline, operations: exactly, base_version: 1 }, ctx());
    expect(ok.applied).toBe(true);
    expect(ok.results).toHaveLength(500);
  });

  it("the batch inverse, applied LIFO, restores the pre-batch state", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const before = stableStringify(timeline);
    const batch = applyBatch(
      {
        timeline,
        operations: [
          op("op_B000000008", "trim", { clip_id: clipIds[1]! }, { side: "in", in: { kind: "clip", clip_id: clipIds[1]!, edge: "in", offset_s: 3 }, ripple: true }),
          op("op_B000000009", "ripple_delete", { clip_id: clipIds[2]! }, { ripple: true }),
        ],
        base_version: 1,
      },
      ctx(),
    );
    expect(batch.applied).toBe(true);
    // Undo is itself a batch (versions advance monotonically); compare state
    // with the key-order-proof comparator.
    const back = applyBatch(
      { timeline: batch.timeline, operations: batch.inverse, base_version: batch.new_version },
      ctx(),
    );
    expect(back.applied).toBe(true);
    expect(stableStringify({ ...back.timeline, version: 1 })).toBe(before);
  });

  it("reports per-op results with snap reports for raw timecodes", () => {
    const { timeline, clipIds } = sequenceTimeline();
    const out = applyBatch(
      {
        timeline,
        operations: [
          op("op_B000000010", "add_caption", { clip_id: clipIds[0]! }, {
            text: "snap me",
            // 100.05 sits inside the planted silence [100.0, 101.5]; 100.5 is 450ms
            // into it — both resolve with snap reports under the default policy.
            from: { kind: "seconds", seconds: 100.05 },
            to: { kind: "seconds", seconds: 100.5 },
          }),
        ],
        base_version: 1,
      },
      ctx(),
    );
    expect(out.applied).toBe(true);
    expect(out.results[0]?.snaps?.length).toBeGreaterThan(0);
  });

  it("empty operations are rejected", () => {
    const { timeline } = sequenceTimeline();
    const out = applyBatch({ timeline, operations: [], base_version: 1 }, ctx());
    expect(out.applied).toBe(false);
  });
});

describe("timeline builders used by the API (M2 surface)", () => {
  it("emptyTimeline + manual clip building round-trips through ops", () => {
    const mint = () => "trk_TEST000009";
    const timeline = {
      version: 1,
      audio: null,
      captions: {},
      tracks: [
        makeTrack({ id: mint(), kind: "video" }),
        makeTrack({ id: mint(), kind: "audio" }),
        makeTrack({ id: mint(), kind: "caption" }),
      ],
      clips: {
        clp_TEST000001: makeClip({ id: "clp_TEST000001", track_id: "", segment_id: "seg_TEST000001", source_out_s: 6 }),
      },
    };
    timeline.tracks[0]!.clip_ids = ["clp_TEST000001"];
    timeline.clips["clp_TEST000001"]!.track_id = timeline.tracks[0]!.id;
    const out = applyBatch(
      { timeline, operations: [op("op_B000000011", "split", { clip_id: "clp_TEST000001", at: { kind: "seconds", seconds: 3 } }, {})], base_version: 1 },
      ctx(),
    );
    expect(out.applied).toBe(true);
    expect(out.results[0]?.ok).toBe(true);
    // The split minted a new clip; per-op results carry the created IDs.
    expect(out.results[0]?.created?.clip_ids?.length).toBe(1);
  });
});
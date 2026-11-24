import { describe, expect, it } from "vitest";
import { applyBatch } from "../src/batch.js";
import { EditHistory, HistoryError } from "../src/history.js";
import { clipAt, sequenceTimeline, testCtx } from "./fixtures.js";
import { stableStringify } from "../src/timeline.js";
import type { Operation } from "@lathe/schemas";

const ctx = () => testCtx();

function op(id: string, type: Operation["type"], target: Record<string, unknown>, params: Record<string, unknown>): Operation {
  return { id, type, group_id: "grp_TEST000001", rationale: `history ${type}`, target, params } as Operation;
}

/** A history with two committed batches against a 3-clip sequence. */
function twoBatchHistory() {
  const { timeline, clipIds } = sequenceTimeline();
  const h = new EditHistory(timeline);
  const b1 = applyBatch(
    {
      timeline,
      operations: [op("op_H000000001", "set_gain", { clip_id: clipIds[0]! }, { gain_db: 4 })],
      base_version: 1,
    },
    ctx(),
  );
  h.commit(
    {
      batch_id: b1.batch_id,
      group_ids: ["grp_TEST000001"],
      actor: "model:test",
      ops: [op("op_H000000001", "set_gain", { clip_id: clipIds[0]! }, { gain_db: 4 })],
      inverse: b1.inverse,
      base_version: b1.previous_version,
      new_version: b1.new_version,
      label: "louder intro",
    },
    b1.timeline,
  );
  const b2 = applyBatch(
    {
      timeline: b1.timeline,
      operations: [op("op_H000000002", "reframe", { clip_id: clipIds[1]! }, { aspect: "1:1", mode: "center", smoothing_s: 0.1, zoom: 1, reset: false })],
      base_version: b1.new_version,
    },
    ctx(),
  );
  h.commit(
    {
      batch_id: b2.batch_id,
      group_ids: ["grp_TEST000002"],
      actor: "model:test",
      ops: [op("op_H000000002", "reframe", { clip_id: clipIds[1]! }, { aspect: "1:1", mode: "center", smoothing_s: 0.1, zoom: 1, reset: false })],
      inverse: b2.inverse,
      base_version: b2.previous_version,
      new_version: b2.new_version,
      label: "square middle",
    },
    b2.timeline,
  );
  return { h, clipIds, original: timeline };
}

describe("undo/redo history (EDT-6)", () => {
  it("undo(last) reverts the newest batch and bumps the version", () => {
    const { h, clipIds } = twoBatchHistory();
    expect(clipAt(h.current, clipIds[1]!).reframe).toMatchObject({ aspect: "1:1" });
    // Two committed batches: v1 -> v2 -> v3; undo advances to v4.
    const r = h.undo({ kind: "last", count: 1 }, ctx());
    expect(r.new_version).toBe(4);
    expect(clipAt(h.current, clipIds[1]!).reframe).toBeNull();
    // The earlier batch survives.
    expect(clipAt(h.current, clipIds[0]!).audio).toEqual({ gain_db: 4 });
  });

  it("redo(last) re-applies the undone batch", () => {
    const { h, clipIds } = twoBatchHistory();
    h.undo({ kind: "last", count: 1 }, ctx());
    const r = h.redo({ kind: "last", count: 1 }, ctx());
    expect(r.new_version).toBe(5);
    expect(clipAt(h.current, clipIds[1]!).reframe).toMatchObject({ aspect: "1:1" });
  });

  it("undo(last, 2) drains both batches to the original state", () => {
    const { h, clipIds, original } = twoBatchHistory();
    const r = h.undo({ kind: "last", count: 2 }, ctx());
    expect(r.reverted_op_ids).toHaveLength(2);
    expect(stableStringify({ ...h.current, version: 1 })).toBe(stableStringify({ ...original, version: 1 }));
    expect(clipAt(h.current, clipIds[0]!).audio).toBeNull();
    // Nothing left to undo.
    expect(() => h.undo({ kind: "last", count: 1 }, ctx())).toThrow(HistoryError);
  });

  it("undo by group only works for the most recent change (linear history)", () => {
    const { h } = twoBatchHistory();
    // grp_TEST000001 is the OLDER group: undo it directly is rejected.
    expect(() => h.undo({ kind: "group", group_id: "grp_TEST000001" }, ctx())).toThrow(/most recent/);
    // The newest group works.
    h.undo({ kind: "group", group_id: "grp_TEST000002" }, ctx());
    // ...and now the older one is reachable.
    h.undo({ kind: "group", group_id: "grp_TEST000001" }, ctx());
  });

  it("undo by batch id works for the newest batch", () => {
    const { h } = twoBatchHistory();
    const b = h.log[1]!.batch_id;
    h.undo({ kind: "batch", batch_id: b }, ctx());
    expect(h.log[1]!.undone).toBe(true);
    // Redo the same batch.
    h.redo({ kind: "batch", batch_id: b }, ctx());
    expect(h.log[1]!.undone).toBe(false);
  });

  it("redo rejects when nothing is undone", () => {
    const { h } = twoBatchHistory();
    expect(() => h.redo({ kind: "last", count: 1 }, ctx())).toThrow(HistoryError);
  });
});
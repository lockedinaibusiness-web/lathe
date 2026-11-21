import { describe, expect, it } from "vitest";
import {
  Operation,
  ApplyEditsRequest,
  ApplyEditsResponse,
  UndoRedoRequest,
  UndoRedoResponse,
  OPERATION_META,
  OPERATION_TYPES,
  MAX_BATCH_OPS,
  DEFAULT_SNAP_POLICY,
  TimeSpec,
  sampleId,
  type Operation as OperationT,
} from "../src/index.js";

const SEG = sampleId("seg", 1);
const CLP = sampleId("clp", 2);
const CAP = sampleId("cap", 3);
const TRK = sampleId("trk", 4);
const AST = sampleId("ast", 5);
const GRP = sampleId("grp", 6);

function op(t: OperationT["type"], target: Record<string, unknown>, params: Record<string, unknown>): OperationT {
  return {
    id: sampleId("op", OPERATION_TYPES.indexOf(t) + 1),
    type: t,
    target,
    params,
    rationale: `test ${t}`,
    group_id: GRP,
  } as OperationT;
}

const SAMPLES: Record<string, OperationT> = {
  split: op("split", { clip_id: CLP, at: { kind: "word", segment_id: SEG, word_index: 42 } }, {}),
  trim: op("trim", { clip_id: CLP }, { side: "out", out: { kind: "word", segment_id: SEG, word_index: 42 } }),
  delete: op("delete", { clip_id: CLP }, {}),
  ripple_delete: op("ripple_delete", { clip_id: CLP }, {}),
  reorder: op("reorder", { clip_id: CLP }, { to_index: 3 }),
  set_speed: op("set_speed", { clip_id: CLP }, { speed: 1.5 }),
  reframe: op("reframe", { clip_id: CLP }, { aspect: "9:16" }),
  zoom: op("zoom", { clip_id: CLP }, { scale: 1.1 }),
  add_transition: op("add_transition", { clip_id: CLP }, { kind: "crossfade", duration_s: 0.5 }),
  add_caption: op("add_caption", { clip_id: CLP }, { text: "Hello world", segment_id: SEG }),
  style_caption: op("style_caption", { caption_id: CAP }, { style_id: sampleId("sty", 9) }),
  add_overlay: op("add_overlay", { clip_id: CLP }, { kind: "logo", asset_id: AST, from: { kind: "seconds", seconds: 1 }, to: { kind: "seconds", seconds: 2 } }),
  set_gain: op("set_gain", { track_id: TRK }, { gain_db: -3 }),
  duck_audio: op("duck_audio", { clip_id: CLP }, { duck_db: -12 }),
  normalize_audio: op("normalize_audio", { scope: "project" }, { target_lufs: -16, true_peak_dbtp: -1 }),
  insert_broll: op("insert_broll", { clip_id: CLP, at: { kind: "seconds", seconds: 10 } }, { source: { kind: "project_asset", asset_id: AST }, duration_s: 4 }),
};

describe("Operation union (EDT-2)", () => {
  it("accepts one valid sample of every operation type", () => {
    expect(OPERATION_TYPES).toHaveLength(16);
    for (const type of OPERATION_TYPES) {
      const r = Operation.safeParse(SAMPLES[type]);
      if (!r.success) throw new Error(`${type} rejected: ${JSON.stringify(r.error.issues)}`);
      expect(r.success).toBe(true);
    }
  });

  it("rejects an unknown type", () => {
    expect(Operation.safeParse({ ...SAMPLES.split, type: "explode" }).success).toBe(false);
  });

  it("requires id, group_id, and a rationale on every operation", () => {
    expect(Operation.safeParse({ ...SAMPLES.split, rationale: "" }).success).toBe(false);
    expect(Operation.safeParse({ ...SAMPLES.split, group_id: undefined }).success).toBe(false);
    expect(Operation.safeParse({ ...SAMPLES.split, id: "not-an-id" }).success).toBe(false);
  });

  it("rejects out-of-range parameters", () => {
    expect(Operation.safeParse({ ...SAMPLES.set_speed, params: { speed: 12 } }).success).toBe(false);
    expect(Operation.safeParse({ ...SAMPLES.set_gain, params: { gain_db: -999 } }).success).toBe(false);
    expect(Operation.safeParse({ ...SAMPLES.zoom, params: { scale: 9 } }).success).toBe(false);
  });

  it("rejects a trim with no bounds", () => {
    expect(Operation.safeParse(op("trim", { clip_id: CLP }, {})).success).toBe(false);
  });
});

describe("operation metadata registry", () => {
  it("covers exactly the union's types", () => {
    expect(Object.keys(OPERATION_META).sort()).toEqual([...OPERATION_TYPES].sort());
  });

  it("every operation is invertible (invariant #2)", () => {
    for (const meta of Object.values(OPERATION_META)) {
      expect(meta.invertible).toBe(true);
    }
  });

  it("duration-affecting ops are the cut/arrange/speed family", () => {
    expect(OPERATION_META.delete.affects_duration).toBe(true);
    expect(OPERATION_META.trim.affects_duration).toBe(true);
    expect(OPERATION_META.set_speed.affects_duration).toBe(true);
    expect(OPERATION_META.reorder.affects_duration).toBe(false);
  });
});

describe("TimeSpec and snapping (invariants #1, #6)", () => {
  it("supports word, clip, frame, and seconds kinds", () => {
    expect(TimeSpec.safeParse({ kind: "word", segment_id: SEG, word_index: 0, edge: "end" }).success).toBe(true);
    expect(TimeSpec.safeParse({ kind: "clip", clip_id: CLP, edge: "out" }).success).toBe(true);
    expect(TimeSpec.safeParse({ kind: "frame", frame: 1200 }).success).toBe(true);
    expect(TimeSpec.safeParse({ kind: "seconds", seconds: 12.5 }).success).toBe(true);
  });

  it("default snap policy prefers silence with a 40 ms tolerance", () => {
    expect(DEFAULT_SNAP_POLICY.avoid_mid_word).toBe(true);
    expect(DEFAULT_SNAP_POLICY.prefer_silence).toBe(true);
    expect(DEFAULT_SNAP_POLICY.tolerance_ms).toBe(40);
    expect(DEFAULT_SNAP_POLICY.pause_inset_ms).toBe(40);
  });
});

describe("apply_edits contract (invariant #3)", () => {
  const batch = (n: number) => ({
    project_id: sampleId("prj", 99),
    base_version: 3,
    idempotency_key: "batch-test-key-0001",
    actor: "model:test",
    operations: Array.from({ length: n }, (_, i) => ({
      ...SAMPLES.split,
      id: sampleId("op", 100 + i),
    })),
  });

  it("enforces the 500-op cap", () => {
    expect(MAX_BATCH_OPS).toBe(500);
    expect(ApplyEditsRequest.safeParse(batch(501)).success).toBe(false);
    expect(ApplyEditsRequest.safeParse(batch(500)).success).toBe(true);
  });

  it("rejects an empty batch", () => {
    expect(ApplyEditsRequest.safeParse(batch(0)).success).toBe(false);
  });

  it("requires idempotency key, base_version, actor", () => {
    const b = batch(1) as Record<string, unknown>;
    expect(ApplyEditsRequest.safeParse({ ...b, idempotency_key: undefined }).success).toBe(false);
    expect(ApplyEditsRequest.safeParse({ ...b, base_version: -1 }).success).toBe(false);
    expect(ApplyEditsRequest.safeParse({ ...b, actor: undefined }).success).toBe(false);
  });

  it("validates a full apply response with per-op results", () => {
    const res = {
      batch_id: sampleId("btc", 1),
      project_id: sampleId("prj", 99),
      previous_version: 3,
      new_version: 4,
      applied: true,
      results: [
        {
          op_id: SAMPLES.split.id,
          ok: true,
          created: { clip_ids: [sampleId("clp", 77)] },
          snap: [{ op_id: SAMPLES.split.id, requested: { kind: "seconds", seconds: 61.3 }, resolved_s: 61.3, applied_s: 61.25, snapped_to: "silence", delta_ms: 50, tolerance_ms: 40 }],
        },
      ],
      conflicts: [],
      summary: "Applied 1 operation.",
    };
    expect(ApplyEditsResponse.safeParse(res).success).toBe(true);
  });
});

describe("undo/redo contract (EDT-6)", () => {
  it("accepts group, batch, and last targets", () => {
    expect(UndoRedoRequest.safeParse({ project_id: sampleId("prj", 1), idempotency_key: "undo-key-00001", target: { kind: "group", group_id: GRP } }).success).toBe(true);
    expect(UndoRedoRequest.safeParse({ project_id: sampleId("prj", 1), idempotency_key: "undo-key-00001", target: { kind: "batch", batch_id: sampleId("btc", 2) } }).success).toBe(true);
    expect(UndoRedoRequest.safeParse({ project_id: sampleId("prj", 1), idempotency_key: "undo-key-00001", target: { kind: "last", count: 3 } }).success).toBe(true);
  });

  it("validates a response with reverted ops and new version", () => {
    expect(UndoRedoResponse.safeParse({
      ok: true,
      reverted_op_ids: [SAMPLES.split.id],
      group_id: GRP,
      new_version: 3,
      summary: "Reverted 1 operation.",
    }).success).toBe(true);
  });
});
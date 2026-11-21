import { describe, expect, it } from "vitest";
import {
  Brief,
  GetBriefRequest,
  GetBriefResponse,
  GetFramesResponse,
  SearchFootageRequest,
  SearchFootageResponse,
  sampleId,
} from "../src/index.js";

const PRJ = sampleId("prj", 12);
const readiness = (state: "pending" | "partial" | "ready" | "failed", progress: number) => ({ state, progress });

const brief = {
  version: "1.0.0",
  project_id: PRJ,
  duration_s: 2510,
  language: "en",
  detail: "standard" as const,
  readiness: {
    transcript: readiness("ready", 1),
    speakers: readiness("ready", 1),
    shots: readiness("partial", 0.62),
    audio: readiness("ready", 1),
    visual: readiness("pending", 0),
    embeddings: readiness("pending", 0),
  },
  speakers: [{ id: sampleId("spk", 1), label: "Speaker 1", share: 0.72 }],
  segments: [
    {
      id: sampleId("seg", 1),
      start_s: 0,
      end_s: 4.2,
      speaker: sampleId("spk", 1),
      text: "Welcome back to the show everyone.",
      words: [
        { w: "Welcome", s: 0.1, e: 0.55, c: 0.99 },
        { w: "back", s: 0.58, e: 0.9, c: 0.98 },
      ],
      shot_id: sampleId("sht", 1),
      tags: ["hook"],
    },
  ],
  shots: [{ id: sampleId("sht", 1), start_s: 0, end_s: 12.5, faces: 1 }],
  audio: {
    silences: [{ s: 6.1, e: 7.4 }],
    loudness_curve: [{ t: 0, lufs: -18.2 }],
    music_ranges: [],
  },
  hints: {
    repeated_takes: [],
    filler_clusters: [{ segment_ids: [sampleId("seg", 4)], removable_s: 2.4 }],
    dead_air: [{ s: 6.1, e: 7.4, suggested_action: "cut" }],
    hook_candidates: [{ segment_id: sampleId("seg", 1), score: 0.81, reason: "strong opener" }],
  },
  omitted_sections: [],
  token_estimate: 41250,
  truncated: false,
};

describe("Brief (BRF-1..4)", () => {
  it("validates a full Brief with per-section readiness (invariant #9)", () => {
    expect(Brief.safeParse(brief).success).toBe(true);
  });

  it("requires readiness on every section", () => {
    const broken = structuredClone(brief) as Record<string, unknown>;
    delete (broken.readiness as Record<string, unknown>).shots;
    expect(Brief.safeParse(broken).success).toBe(false);
  });

  it("word shape is {w, s, e, c} with confidence 0..1", () => {
    expect(Brief.safeParse({ ...brief, segments: [{ ...brief.segments[0], words: [{ w: "x", s: 1, e: 2, c: 2 }] }] }).success).toBe(false);
  });

  it("detail levels are summary/standard/full", () => {
    for (const detail of ["summary", "standard", "full"] as const) {
      expect(Brief.safeParse({ ...brief, detail }).success).toBe(true);
    }
  });
});

describe("Brief range queries (BRF-3)", () => {
  it("accepts segment, time, speaker, and shot ranges", () => {
    expect(GetBriefRequest.safeParse({ project_id: PRJ, range: { kind: "segments", ids: [sampleId("seg", 1)] } }).success).toBe(true);
    expect(GetBriefRequest.safeParse({ project_id: PRJ, range: { kind: "time", start_s: 0, end_s: 60 } }).success).toBe(true);
    expect(GetBriefRequest.safeParse({ project_id: PRJ, range: { kind: "speakers", ids: [sampleId("spk", 1)] } }).success).toBe(true);
    expect(GetBriefRequest.safeParse({ project_id: PRJ, range: { kind: "shots", ids: [sampleId("sht", 1)] } }).success).toBe(true);
  });

  it("rejects empty segment ranges", () => {
    expect(GetBriefRequest.safeParse({ project_id: PRJ, range: { kind: "segments", ids: [] } }).success).toBe(false);
  });

  it("validates a response with pending sections", () => {
    expect(GetBriefResponse.safeParse({ brief, pending_sections: ["visual", "embeddings"], summary: "42 min of footage; shots pending" }).success).toBe(true);
  });
});

describe("frames and search", () => {
  it("validates a frames response with signed URLs", () => {
    expect(GetFramesResponse.safeParse({
      project_id: PRJ,
      frames: [{ t: 1.5, segment_id: sampleId("seg", 1), url: "https://media.lathe.dev/frame.jpg?sig=x", width: 320, height: 180 }],
      summary: "1 frame returned",
    }).success).toBe(true);
  });

  it("validates a keyword search hit", () => {
    expect(SearchFootageRequest.safeParse({ project_id: PRJ, query: "pricing experiment", mode: "keyword" }).success).toBe(true);
    expect(SearchFootageResponse.safeParse({
      project_id: PRJ,
      mode: "keyword",
      hits: [{ kind: "segment", segment: brief.segments[0], score: 0.91, matched_words: ["pricing"] }],
      summary: "1 hit",
    }).success).toBe(true);
  });
});
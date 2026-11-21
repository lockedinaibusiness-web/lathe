import { describe, expect, it } from "vitest";
import type {
  JobType} from "../src/index.js";
import {
  JobEnvelope,
  JobResultMessage,
  JobPayloads,
  JOB_CONTRACT_VERSION,
  queueName,
  TranscriptResult,
  DiarizationResult,
  ShotsResult,
  AudioFeaturesResult,
  GetStatusResponse,
  sampleId,
} from "../src/index.js";

const JOB_TYPES: JobType[] = [
  "proxy.generate",
  "analysis.transcribe",
  "analysis.diarize",
  "analysis.shots",
  "analysis.audio_features",
  "analysis.embeddings",
  "analysis.visual",
  "preview.render",
  "render.full",
  "export.interchange",
  "export.captions",
  "verify.run",
];

const samples: Record<JobType, Record<string, unknown>> = {
  "proxy.generate": { project_id: sampleId("prj", 1), resolutions: ["720p"] },
  "analysis.transcribe": { project_id: sampleId("prj", 1), word_timestamps: true },
  "analysis.diarize": { project_id: sampleId("prj", 1), allow_single_speaker_fallback: true },
  "analysis.shots": { project_id: sampleId("prj", 1), threshold: 27 },
  "analysis.audio_features": { project_id: sampleId("prj", 1), detect_beats: true },
  "analysis.embeddings": { project_id: sampleId("prj", 1), targets: ["segments"] },
  "analysis.visual": { project_id: sampleId("prj", 1), detect_faces: true },
  "preview.render": { project_id: sampleId("prj", 1), timeline_version: 4 },
  "render.full": { project_id: sampleId("prj", 1), timeline_version: 4, preset_id: "youtube_1080p" },
  "export.interchange": { project_id: sampleId("prj", 1), timeline_version: 4, format: "otio" },
  "export.captions": { project_id: sampleId("prj", 1), timeline_version: 4, format: "srt" },
  "verify.run": { project_id: sampleId("prj", 1), timeline_version: 4 },
};

describe("job contracts (TS <-> Python boundary)", () => {
  it("queue names are derived from job type", () => {
    expect(queueName("analysis.transcribe")).toBe("lathe.analysis.transcribe");
    expect(queueName("render.full")).toBe("lathe.render.full");
  });

  it("validates a sample payload for every job type", () => {
    for (const type of JOB_TYPES) {
      const r = JobPayloads[type].safeParse(samples[type]);
      if (!r.success) throw new Error(`${type} payload rejected: ${JSON.stringify(r.error.issues)}`);
      expect(r.success).toBe(true);
    }
  });

  it("validates a full envelope and a worker result message", () => {
    const envelope = {
      job_id: sampleId("job", 1),
      contract_version: JOB_CONTRACT_VERSION,
      type: "analysis.transcribe",
      project_id: sampleId("prj", 1),
      payload: samples["analysis.transcribe"],
      idempotency_key: "analysis-ep12-0001",
      attempt: 0,
      max_attempts: 3,
      priority: 2,
      created_at: "2026-11-21T10:00:00.000Z",
    };
    expect(JobEnvelope.safeParse(envelope).success).toBe(true);

    const result = {
      job_id: sampleId("job", 1),
      contract_version: JOB_CONTRACT_VERSION,
      state: "completed" as const,
      result: { words: 512 },
      metrics: { wall_s: 12.4 },
    };
    expect(JobResultMessage.safeParse(result).success).toBe(true);
  });

  it("rejects a stale contract version in the envelope", () => {
    expect(JobEnvelope.safeParse({
      job_id: sampleId("job", 1),
      contract_version: "0.9.0",
      type: "analysis.shots",
      project_id: sampleId("prj", 1),
      payload: samples["analysis.shots"],
      idempotency_key: "analysis-ep12-0001",
      created_at: "2026-11-21T10:00:00.000Z",
    }).success).toBe(false);
  });
});

describe("analysis result payloads", () => {
  it("transcript carries word timings and confidences", () => {
    expect(TranscriptResult.safeParse({
      language: "en",
      duration_s: 2510,
      words: [{ w: "hello", s: 0.1, e: 0.4, c: 0.99 }],
      engine: "faster-whisper",
      model: "small.en",
    }).success).toBe(true);
  });

  it("diarization marks the single-speaker fallback", () => {
    expect(DiarizationResult.safeParse({
      speakers: [{ id: sampleId("spk", 1), total_speech_s: 1800, fallback: true }],
      turns: [{ speaker: sampleId("spk", 1), start_s: 0, end_s: 600 }],
    }).success).toBe(true);
  });

  it("shots and audio features parse", () => {
    expect(ShotsResult.safeParse({ shots: [{ id: sampleId("sht", 1), start_s: 0, end_s: 8 }], detector: "pyscenedetect" }).success).toBe(true);
    expect(AudioFeaturesResult.safeParse({
      silences: [{ s: 6.1, e: 7.4 }],
      loudness_curve: [{ t: 0, lufs: -18.2 }],
      music_ranges: [{ s: 0, e: 600, kind: "mixed" }],
      beats: [{ t: 3.2, strength: 0.8 }],
    }).success).toBe(true);
  });

  it("get_status response validates", () => {
    expect(GetStatusResponse.safeParse({
      project_id: sampleId("prj", 1),
      jobs: [],
      readiness: { transcript: "ready" },
      summary: "no jobs; transcript ready",
    }).success).toBe(true);
  });
});
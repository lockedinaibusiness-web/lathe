import { z } from "zod";
import { Ms } from "./time.js";

/**
 * Contract for the deterministic fixture manifest (M0). The manifest holds
 * only machine-independent expectations (times, tolerances). File hashes are
 * recorded in a separate build-info artifact that is NOT committed, because
 * encoded bytes differ across ffmpeg builds; determinism is verified by
 * regenerating twice and comparing within one machine.
 */
export const FixtureArtifact = z
  .object({
    name: z.string().min(1).max(80),
    kind: z.enum(["video", "audio", "json"]),
    path: z.string().min(1).max(200).describe("Path relative to fixtures/generated/."),
    duration_ms: Ms.optional(),
  })
  .describe("One generated fixture artifact.");

export const ExpectedSilence = z
  .object({ s: Ms, e: Ms, tolerance_ms: z.number().int().min(0).max(500).default(50) })
  .describe("A planted silence; analyzers must detect it within tolerance.");

export const ExpectedSceneChange = z
  .object({ t_ms: Ms, tolerance_ms: z.number().int().min(0).max(500).default(84).describe("Default = 2 frames at 24fps.") })
  .describe("A planted hard cut.");

export const ExpectedSpeechSegment = z
  .object({ s: Ms, e: Ms, text: z.string().max(500).optional(), speaker: z.string().max(80).optional() })
  .describe("A planted speech span (TTS or tone substitute).");

export const ExpectedLoudness = z
  .object({ integrated_lufs: z.number(), tolerance_lu: z.number().min(0.1).max(3).default(1) })
  .describe("Expected integrated loudness of the fixture.");

export const FixtureExpectations = z
  .object({
    fixture: z.string().min(1).max(80),
    silences: z.array(ExpectedSilence),
    scene_changes: z.array(ExpectedSceneChange),
    speech_segments: z.array(ExpectedSpeechSegment),
    loudness: ExpectedLoudness.optional(),
    gop_size_frames: z.number().int().min(1).optional(),
  })
  .describe("Analysis expectations for one fixture.");

export const FixturesManifest = z
  .object({
    contract_version: z.literal("1"),
    speech_kind: z.enum(["tts", "tone"]).describe("tts = Windows SAPI speech; tone = deterministic substitute."),
    ffmpeg_version_line: z.string().max(200).describe("First line of `ffmpeg -version` used at generation time."),
    artifacts: z.array(FixtureArtifact).min(1),
    expectations: z.array(FixtureExpectations).min(1),
  })
  .describe("Manifest of deterministic test fixtures and their expected analysis results.");

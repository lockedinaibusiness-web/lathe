/**
 * Shared enums and small primitives referenced by more than one contract.
 */

import { z } from "zod";

/**
 * Version of ALL Lathe contracts (operations, Brief, jobs, tools, HTTP API).
 * Every generated artifact stamps this; the API exposes it at /healthz and
 * /v1/__contract_version. Breaking changes bump the major version.
 */
export const CONTRACTS_VERSION = "1.0.0";

/** $id of the bundled JSON Schema document (used by the API for serialization). */
export const SCHEMA_BUNDLE_ID = "https://lathe.dev/schemas/lathe.contracts.schema.json";

/** Brief / analysis detail levels (BRF-3). */
export const DetailLevel = z.enum(["summary", "standard", "full"]);
export type DetailLevel = z.infer<typeof DetailLevel>;

/**
 * Progressive readiness (invariant #9). `pending` = not started or queued,
 * `partial` = some data usable, `ready` = complete, `failed` = worker failed
 * (findings/retry handled by the job system). `progress` is 0..1 and always
 * present so the model can render a progress view without extra calls.
 */
export const SectionReadiness = z.object({
  state: z.enum(["pending", "partial", "ready", "failed"]),
  progress: z.number().min(0).max(1),
  updated_at: z.string().datetime().optional(),
  note: z.string().max(300).optional(),
});
export type SectionReadiness = z.infer<typeof SectionReadiness>;

export const Severity = z.enum(["error", "warning", "info"]);
export type Severity = z.infer<typeof Severity>;

/** Who performed a change (audit invariant; shown in the review UI). */
export const ActorType = z.enum(["user", "model", "system"]);
export type ActorType = z.infer<typeof ActorType>;

export const Actor = z.object({
  type: ActorType,
  id: z.string().min(1).max(64),
  /** e.g. "claude-sonnet-4-5@anthropic" for model actors; null for users. */
  model: z.string().max(128).optional(),
});
export type Actor = z.infer<typeof Actor>;

export const JobState = z.enum([
  "queued",
  "active",
  "completed",
  "failed",
  "cancelled",
  "waiting", // waiting on a dependency job
]);
export type JobState = z.infer<typeof JobState>;

export const JobPriority = z.union([
  z.literal(0), // fastest lane: previews
  z.literal(1), // interactive: verify, proxies
  z.literal(2), // standard: analysis, renders
  z.literal(3), // background: embeddings, exports
]);
export type JobPriority = z.infer<typeof JobPriority>;

export const AspectRatio = z.enum(["16:9", "9:16", "1:1", "4:5", "4:3", "21:9", "custom"]);
export type AspectRatio = z.infer<typeof AspectRatio>;

export const LanguageCode = z
  .string()
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/, "ISO 639-1 with optional region, e.g. en or pt-BR");
export type LanguageCode = z.infer<typeof LanguageCode>;

/** ISO-8601 timestamp, UTC. */
export const Timestamp = z.string().datetime({ offset: true });
export type Timestamp = z.infer<typeof Timestamp>;

/** Every mutating contract accepts an idempotency key (invariant #4). */
export const IdempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "URL-safe token; clients should use a UUID or ULID");

/** Short human-readable summary line required on every tool result (PLG-5). */
export const Summary = z.string().min(1).max(500).describe("Short human-readable summary for the model");
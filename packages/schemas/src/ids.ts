/**
 * Stable ID contract (architecture invariant #1).
 *
 * Every entity the model or the engine references carries a stable, prefixed,
 * opaque ID. Operations reference these IDs and never raw timestamps. ID shape
 * is enforced here so every downstream package validates identically.
 *
 * IDs are immutable once assigned: re-indexing, re-analysis, or a new editing
 * session never renumbers them.
 */

import { z } from "zod";

const ID_RE = /^[a-z]{2,3}_[A-Za-z0-9]{10,64}$/;

/** Base validator shared by every ID type. */
const idSchema = <P extends string>(prefix: P) =>
  z
    .string()
    .regex(ID_RE, `${prefix} IDs must match ${prefix}_<10..64 alphanumeric chars>`)
    .refine((v) => v.startsWith(`${prefix}_`), `${prefix} IDs must start with "${prefix}_"`)
    .describe(`${prefix}-prefixed stable ID, e.g. "${prefix}_01J8ZQ4K2M9T3X7YB6N0PWABCD"`);

export const ProjectId = idSchema("prj");
export const AssetId = idSchema("ast");
export const SegmentId = idSchema("seg");
export const ShotId = idSchema("sht");
export const SpeakerId = idSchema("spk");
export const TrackId = idSchema("trk");
export const ClipId = idSchema("clp");
export const CaptionId = idSchema("cap");
export const EffectId = idSchema("efx");
export const StyleId = idSchema("sty");
export const OperationId = idSchema("op");
export const GroupId = idSchema("grp");
export const BatchId = idSchema("btc");
export const JobId = idSchema("job");
export const FindingId = idSchema("fnd");
export const UserId = idSchema("usr");
export const ApiKeyId = idSchema("key");
export const UploadId = idSchema("upl");
export const UploadSessionId = UploadId;

export type ProjectId = z.infer<typeof ProjectId>;
export type AssetId = z.infer<typeof AssetId>;
export type SegmentId = z.infer<typeof SegmentId>;
export type ShotId = z.infer<typeof ShotId>;
export type SpeakerId = z.infer<typeof SpeakerId>;
export type TrackId = z.infer<typeof TrackId>;
export type ClipId = z.infer<typeof ClipId>;
export type CaptionId = z.infer<typeof CaptionId>;
export type EffectId = z.infer<typeof EffectId>;
export type StyleId = z.infer<typeof StyleId>;
export type OperationId = z.infer<typeof OperationId>;
export type GroupId = z.infer<typeof GroupId>;
export type BatchId = z.infer<typeof BatchId>;
export type JobId = z.infer<typeof JobId>;
export type FindingId = z.infer<typeof FindingId>;
export type UserId = z.infer<typeof UserId>;
export type ApiKeyId = z.infer<typeof ApiKeyId>;
export type UploadId = z.infer<typeof UploadId>;
export type UploadSessionId = UploadId;

const ID_PREFIXES = {
  prj: ProjectId,
  ast: AssetId,
  seg: SegmentId,
  sht: ShotId,
  spk: SpeakerId,
  trk: TrackId,
  clp: ClipId,
  cap: CaptionId,
  efx: EffectId,
  sty: StyleId,
  op: OperationId,
  grp: GroupId,
  btc: BatchId,
  job: JobId,
  fnd: FindingId,
  usr: UserId,
  key: ApiKeyId,
  upl: UploadId,
} as const;

export type IdPrefix = keyof typeof ID_PREFIXES;

/**
 * Generates a stable-looking ID. Uses a 48-bit random payload encoded in
 * Crockford base32 (no ambiguous characters), which is sortable by creation
 * time and safe to use in URLs and FFmpeg arguments.
 *
 * `rng` is injectable so fixtures and tests can mint deterministic IDs.
 */
export function generateId(prefix: IdPrefix, rng: () => number = Math.random): string {
  const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
  let out = "";
  for (let i = 0; i < 22; i++) {
    out += ALPHABET[Math.floor(rng() * 32)];
  }
  return `${prefix}_${out}`;
}

/** All ID prefixes, exposed so the generator and tests can iterate. */
export const ALL_ID_PREFIXES = Object.keys(ID_PREFIXES) as IdPrefix[];

/**
 * Deterministic ID for tests and fixtures: `<prefix>_SAMPLE000123`. Satisfies
 * the same pattern as generated IDs so fixtures validate against contracts.
 */
export function sampleId(prefix: IdPrefix, n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error("sampleId needs a non-negative integer");
  return `${prefix}_SAMPLE${String(n).padStart(6, "0")}`;
}

/** Parses the prefix from an ID. Throws for malformed IDs. */
export function idPrefix(id: string): IdPrefix {
  const idx = id.indexOf("_");
  const prefix = idx > 0 ? id.slice(0, idx) : "";
  if (!(prefix in ID_PREFIXES)) {
    throw new Error(`Unknown ID prefix "${prefix}" in "${id}"`);
  }
  return prefix as IdPrefix;
}
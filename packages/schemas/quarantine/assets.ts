import { z } from "zod";
import { AssetId, ProjectId, UploadSessionId } from "./ids.js";
import { Ms } from "./time.js";
import { Sha256Hex } from "./common.js";

/** All media access happens through signed, expiring URLs (Security reqs). */
export const ProxyInfo = z
  .object({
    kind: z.enum(["edit", "preview"]).describe("edit = 720p all-intra/short-GOP working copy; preview = low-res."),
    storage_key: z.string().min(1).max(512),
    width: z.number().int().min(16).max(8192),
    height: z.number().int().min(16).max(8192),
    codec: z.string().min(1).max(40),
  })
  .describe("A proxy rendition of a source asset.");

export const AssetVideoInfo = z.object({
  codec: z.string().min(1).max(40),
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
  fps_num: z.number().int().min(1).max(1000),
  fps_den: z.number().int().min(1).max(1001),
  bitrate_bps: z.number().int().nonnegative(),
  variable_framerate: z.boolean().describe("VFR sources trigger full re-encode fallback in smart render."),
});

export const AssetAudioInfo = z.object({
  codec: z.string().min(1).max(40),
  sample_rate: z.number().int().min(8000).max(192000),
  channels: z.number().int().min(1).max(16),
});

export const Asset = z
  .object({
    id: AssetId,
    project_id: ProjectId,
    filename: z.string().min(1).max(255),
    size_bytes: z.number().int().min(1).max(50_000_000_000).describe("ING-1: up to 50 GB per file."),
    content_sha256: Sha256Hex,
    created_ms: z.number().int().nonnegative(),
    duration_ms: Ms.optional(),
    video: AssetVideoInfo.optional(),
    audio: AssetAudioInfo.optional(),
    proxies: z.array(ProxyInfo).default([]),
  })
  .describe("A source media asset. Media is private per account and never deletable via edit tools (Invariant 8).");

export const CreateUploadSessionRequest = z
  .object({
    project_id: ProjectId,
    filename: z.string().min(1).max(255),
    size_bytes: z.number().int().min(1).max(50_000_000_000),
  })
  .strict()
  .describe("Open a chunked, resumable upload session (ING-2).");

export const UploadSession = z
  .object({
    id: UploadSessionId,
    project_id: ProjectId,
    asset_id: AssetId.describe("Asset created upfront; filled when the upload completes."),
    chunk_size: z.number().int().min(1_000_000).max(100_000_000).describe("Server-chosen chunk size in bytes."),
    total_bytes: z.number().int().min(1),
    received_chunks: z.array(z.number().int().min(0)).describe("Indices of chunks already stored (resume support)."),
    expires_ms: z.number().int().nonnegative(),
  })
  .describe("A resumable upload session. Analysis may start on first completed chunks (ING-2).");

export const CompleteUploadRequest = z
  .object({ upload_session_id: UploadSessionId })
  .strict()
  .describe("Mark an upload complete after all chunks are stored; kicks off ingest+analysis jobs.");

export const SignedUrlRequest = z
  .object({
    storage_key: z.string().min(1).max(512),
    method: z.literal("GET").default("GET"),
    ttl_s: z.number().int().min(1).max(3600).describe("URL lifetime; short by design."),
  })
  .strict()
  .describe("Request a signed, expiring media URL. Keys are validated against the authorized project.");

export const SignedUrl = z
  .object({
    url: z.string().min(1).max(2048).describe("Signed URL. Never logged (security rule 9)."),
    expires_ms: z.number().int().nonnegative(),
  })
  .describe("A signed, expiring media URL.");

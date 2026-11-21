import { z } from "zod";
import { ProjectId, SegmentId, ShotId } from "./ids.js";
import { Ms } from "./time.js";

/**
 * Search and frame-discovery contracts shared by MCP tools (search_footage,
 * get_frames) and the HTTP API.
 */
export const SearchFootageRequest = z
  .object({
    project_id: ProjectId,
    query: z.string().min(1).max(200).describe("Natural-language or keyword query."),
    mode: z.enum(["keyword", "semantic", "auto"]).default("auto"),
    limit: z.number().int().min(1).max(50).default(20),
    in_range: z
      .object({ from_ms: Ms, to_ms: Ms })
      .strict()
      .optional()
      .describe("Restrict hits to this timeline range."),
  })
  .strict()
  .describe("Search over transcript (keyword) and, when ready, embeddings (semantic).");

export const SearchFootageResult = z
  .object({
    mode_used: z.enum(["keyword", "semantic"]),
    hits: z
      .array(
        z
          .object({
            segment_ids: z.array(SegmentId).min(1),
            shot_ids: z.array(ShotId).optional(),
            score: z.number().min(0).max(1),
            snippet: z.string().max(300).describe("UNTRUSTED transcript excerpt around the hit."),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .describe("Ranked search hits.");

export const GetFramesRequest = z
  .object({
    project_id: ProjectId,
    segment_ids: z.array(SegmentId).min(1).max(16).optional(),
    time_points_ms: z.array(Ms).min(1).max(16).optional(),
    max_frames: z.number().int().min(1).max(16).default(6),
    include_contact_sheet: z.boolean().default(false),
  })
  .strict()
  .refine((i) => i.segment_ids !== undefined || i.time_points_ms !== undefined, {
    message: "provide segment_ids or time_points_ms",
  })
  .describe("Request still frames for visual verification (BRF-6).");

export const GetFramesResult = z
  .object({
    frames: z
      .array(
        z
          .object({
            segment_id: SegmentId.optional(),
            t_ms: Ms,
            storage_key: z.string().max(512).describe("Fetch via a signed URL (media:read)."),
          })
          .strict(),
      )
      .max(16),
    contact_sheet: z
      .object({ storage_key: z.string().max(512), cols: z.number().int().min(1), rows: z.number().int().min(1) })
      .strict()
      .optional(),
  })
  .strict()
  .describe("Extracted frames as storage keys.");

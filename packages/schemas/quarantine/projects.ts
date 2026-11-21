import { z } from "zod";
import { ProjectId, StyleId, UploadSessionId } from "./ids.js";

export const ProjectStatus = z.enum(["created", "indexing", "ready", "failed"]);

export const Project = z
  .object({
    id: ProjectId,
    title: z.string().min(1).max(200),
    status: ProjectStatus,
    timeline_version: z.number().int().min(1),
    style_id: StyleId.optional(),
    created_ms: z.number().int().nonnegative(),
    updated_ms: z.number().int().nonnegative(),
  })
  .describe("A project: one editing workspace with assets, a timeline, and jobs.");

export const CreateProjectRequest = z
  .object({
    title: z.string().min(1).max(200),
    style_id: StyleId.optional(),
    source: z
      .union([
        z.object({ upload_session_id: UploadSessionId }).strict(),
        z.object({ import_url: z.string().url().max(2048) }).strict().describe("ING-11 (P1): import from URL."),
      ])
      .optional()
      .describe("Optionally attach a source asset."),
  })
  .strict()
  .describe("Create a project.");

export const ProjectList = z
  .object({
    projects: z.array(Project),
    next_cursor: z.string().max(128).optional(),
  })
  .describe("Paginated project list.");

/**
 * Project contracts shared by the HTTP API and the MCP tool surface.
 */

import { z } from "zod";
import { ProjectId, StyleId, UploadSessionId } from "./ids.js";

export const ProjectStatus = z.enum(["created", "indexing", "ready", "failed"]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const Project = z.object({
  id: ProjectId,
  title: z.string().min(1).max(200),
  status: ProjectStatus,
  timeline_version: z.number().int().min(1),
  style_id: StyleId.optional(),
  created_ms: z.number().int().nonnegative(),
  updated_ms: z.number().int().nonnegative(),
});
export type Project = z.infer<typeof Project>;

export const ProjectList = z.object({
  projects: z.array(Project),
  next_cursor: z.string().max(128).optional(),
});
export type ProjectList = z.infer<typeof ProjectList>;

export const CreateProjectRequest = z
  .object({
    title: z.string().min(1).max(200),
    style_id: StyleId.optional(),
    source: z
      .union([
        z.object({ upload_session_id: UploadSessionId }),
        z.object({ import_url: z.string().url().max(2048) }),
      ])
      .optional()
      .describe("Optionally attach a source asset (completed upload session or import URL)."),
  })
  .describe("Create a project.");
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;
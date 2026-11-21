/**
 * The complete MCP tool surface: about 20 high-level tools (PLG-3).
 * Aggregated from tools_a/b/c so the registry stays reviewable.
 */

import type { McpToolDef } from "./registry.js";
import * as A from "./tools_a.js";
import * as B from "./tools_b.js";
import * as C from "./tools_c.js";

export const TOOLS: McpToolDef[] = [
  A.createProjectTool,
  A.getBriefTool,
  A.searchFootageTool,
  A.getFramesTool,
  A.listStylesTool,
  A.planEditTool,
  A.getStatusTool,
  B.applyEditsTool,
  B.removeFillersTool,
  B.extractClipsTool,
  B.undoTool,
  B.redoTool,
  C.addCaptionsTool,
  C.reframeTool,
  C.audioCleanupTool,
  C.findBrollTool,
  C.translateTool,
  C.previewTool,
  C.verifyTool,
  C.renderTool,
  C.exportProjectTool,
];

/** Tools the PRD names, used by tests to assert the surface matches. */
export const EXPECTED_TOOL_NAMES = [
  "create_project",
  "get_brief",
  "search_footage",
  "get_frames",
  "list_styles",
  "plan_edit",
  "apply_edits",
  "remove_fillers",
  "extract_clips",
  "add_captions",
  "reframe",
  "audio_cleanup",
  "find_broll",
  "translate",
  "preview",
  "verify",
  "undo",
  "redo",
  "render",
  "export_project",
  "get_status",
] as const;

export function toolByName(name: string): McpToolDef {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool;
}

export * from "./registry.js";
/**
 * MCP tool-definition registry (PLG-1, PLG-3, PLG-5).
 *
 * Every tool is declared once here as data: name, a model-facing description
 * with worked examples, strict input/output schemas, required error codes with
 * suggested_fix text, and MCP annotations. The MCP server (M6) registers
 * handlers against this registry; the generator emits the tool manifest for
 * the OpenAPI/function-calling fallback.
 */

import { z } from "zod";
import { ErrorCodes, type ErrorCode } from "../errors.js";
import type { Summary } from "../common.js";

/** A worked example shown to the model in the tool description. */
export const ToolExample = z.object({
  title: z.string().min(1).max(120),
  input: z.record(z.string(), z.unknown()).describe("Example input object"),
  /** What the model gets back, in prose (the `summary` field of the result). */
  output_summary: z.string().min(1).max(500),
});
export type ToolExample = z.infer<typeof ToolExample>;

export const ToolAnnotations = z.object({
  /** Read-only tools never mutate state. */
  readOnlyHint: z.boolean(),
  /** Destructive tools (undo, delete paths) require confirmation semantics. */
  destructiveHint: z.boolean().optional(),
  /** Mutating tools must accept an idempotency key (invariant #4). */
  idempotentHint: z.boolean().optional(),
  /** Tools that talk to the network or media pipeline. */
  openWorldHint: z.boolean().optional(),
});
export type ToolAnnotations = z.infer<typeof ToolAnnotations>;

export interface McpToolDef {
  name: string;
  title: string;
  /** The model-facing description. MUST contain the worked examples inline. */
  description: string;
  input: z.ZodTypeAny;
  output: z.ZodTypeAny;
  annotations: ToolAnnotations;
  /** Error codes this tool can return; each must exist in the catalog. */
  errors: ErrorCode[];
  /** At least two worked examples (PLG-5), also rendered into the description. */
  examples: ToolExample[];
  /** OAuth scopes required to call this tool. */
  scopes: string[];
}

/**
 * Builds a validated tool definition. Enforces the registry rules at module
 * load time (fail fast): every output has a `summary` field, every error code
 * exists with a suggested_fix, and there are at least two worked examples.
 */
export function defineTool(def: McpToolDef): McpToolDef {
  if (def.examples.length < 2) {
    throw new Error(`Tool "${def.name}" needs at least two worked examples`);
  }
  for (const code of def.errors) {
    if (!(code in ErrorCodes)) {
      throw new Error(`Tool "${def.name}" references unknown error code "${code}"`);
    }
  }
  const outputShape = (def.output as z.ZodObject<z.ZodRawShape>).shape;
  if (!("summary" in outputShape)) {
    throw new Error(`Tool "${def.name}" output must include a summary field`);
  }
  for (const ex of def.examples) {
    if (!ex.output_summary || ex.output_summary.length < 1) {
      throw new Error(`Tool "${def.name}" example "${ex.title}" needs an output summary`);
    }
  }
  if (def.annotations.readOnlyHint === false && def.annotations.idempotentHint !== true) {
    throw new Error(`Mutating tool "${def.name}" must be idempotent (idempotency key)`);
  }
  return def;
}

/** Renders the full model-facing description (text + inline examples). */
export function renderToolDescription(def: McpToolDef): string {
  const lines: string[] = [def.description.trim()];
  if (def.examples.length > 0) {
    lines.push("", "Worked examples:");
    def.examples.forEach((ex, i) => {
      lines.push(
        `${i + 1}. ${ex.title}`,
        `   Input: ${JSON.stringify(ex.input)}`,
        `   Returns (summary): ${ex.output_summary}`,
      );
    });
  }
  return lines.join("\n");
}

/** Placeholder to keep the Summary type referenced (docs/tests use it). */
export type { Summary };
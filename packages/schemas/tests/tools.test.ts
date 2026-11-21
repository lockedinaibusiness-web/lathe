import { describe, expect, it } from "vitest";
import {
  TOOLS,
  EXPECTED_TOOL_NAMES,
  toolByName,
  renderToolDescription,
  isErrorCode,
} from "../src/index.js";
import { z } from "zod";

describe("MCP tool registry (PLG-1, PLG-3, PLG-5)", () => {
  it("registers exactly the 21 contract tools", () => {
    expect(TOOLS).toHaveLength(EXPECTED_TOOL_NAMES.length);
    expect(new Set(TOOLS.map((t) => t.name))).toEqual(new Set<string>(EXPECTED_TOOL_NAMES));
  });

  it("tool names are unique and snake_case", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("every tool has >= 2 worked examples whose inputs parse against the input schema", () => {
    for (const tool of TOOLS) {
      expect(tool.examples.length, `${tool.name} examples`).toBeGreaterThanOrEqual(2);
      tool.examples.forEach((ex, i) => {
        const r = tool.input.safeParse(ex.input);
        if (!r.success) {
          throw new Error(
            `${tool.name} example ${i} (${ex.title}) input invalid: ${JSON.stringify(r.error.issues)}`,
          );
        }
      });
    }
  });

  it("every tool description contains both worked examples inline", () => {
    for (const tool of TOOLS) {
      const rendered = renderToolDescription(tool);
      for (const ex of tool.examples) {
        expect(rendered, `${tool.name} description mentions "${ex.title}"`).toContain(ex.title);
      }
      expect(rendered.length).toBeGreaterThan(80);
    }
  });

  it("every tool output carries a summary field, and declared errors exist", () => {
    for (const tool of TOOLS) {
      const shape = (tool.output as z.ZodObject<z.ZodRawShape>).shape;
      expect("summary" in shape, `${tool.name} output.summary`).toBe(true);
      expect(tool.errors.length).toBeGreaterThan(0);
      for (const code of tool.errors) expect(isErrorCode(code), `${tool.name} error ${code}`).toBe(true);
    }
  });

  it("mutating tools are idempotent; read-only tools are not", () => {
    for (const tool of TOOLS) {
      if (tool.annotations.readOnlyHint) {
        expect(tool.annotations.idempotentHint, `${tool.name}`).toBeUndefined();
      } else {
        expect(tool.annotations.idempotentHint, `${tool.name}`).toBe(true);
      }
    }
  });

  it("tool input/output schemas convert to JSON Schema", () => {
    for (const tool of TOOLS) {
      const input = z.toJSONSchema(tool.input, { target: "draft-2020-12" }) as Record<string, unknown>;
      const output = z.toJSONSchema(tool.output, { target: "draft-2020-12" }) as Record<string, unknown>;
      expect(input.type).toBe("object");
      expect(output.type).toBe("object");
    }
  });

  it("toolByName resolves and rejects unknown names", () => {
    expect(toolByName("apply_edits").name).toBe("apply_edits");
    expect(() => toolByName("nope")).toThrow(/Unknown tool/);
  });
});
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { TOOLS, CONTRACTS_VERSION, Operation, sampleId } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const jsonSchemaDir = join(pkgRoot, "generated/json-schema");
const repoRoot = join(pkgRoot, "../..");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("generated artifacts (contract-before-code)", () => {
  it("json-schema directory, bundle, mcp manifest, openapi, and docs index exist", () => {
    expect(existsSync(jsonSchemaDir)).toBe(true);
    expect(readdirSync(jsonSchemaDir).length).toBeGreaterThan(30);
    expect(existsSync(join(pkgRoot, "generated/lathe.contracts.schema.json"))).toBe(true);
    expect(existsSync(join(repoRoot, "docs/generated/mcp-tools.json"))).toBe(true);
    expect(existsSync(join(repoRoot, "docs/generated/openapi.json"))).toBe(true);
    expect(existsSync(join(repoRoot, "docs/schemas/INDEX.md"))).toBe(true);
  });

  it("bundle contains a definition for every generated contract", () => {
    const bundle = readJson(join(pkgRoot, "generated/lathe.contracts.schema.json"));
    expect(bundle.$id).toContain("lathe.contracts.schema.json");
    expect(Object.keys(bundle.definitions).length).toBeGreaterThan(30);
    const index = readJson(join(jsonSchemaDir, "index.json"));
    for (const entry of index.contracts) {
      expect(bundle.definitions[entry.title], entry.title).toBeDefined();
    }
  });

  it("generated operation schema validates samples and rejects invalid ones", () => {
    const schema = readJson(join(jsonSchemaDir, "operation.schema.json"));
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const good = Operation.parse({
      id: sampleId("op", 1),
      type: "trim",
      group_id: sampleId("grp", 1),
      target: { clip_id: sampleId("clp", 1) },
      params: { side: "in", in: { kind: "seconds", seconds: 5 } },
      rationale: "tighten intro",
    });
    expect(validate(good)).toBe(true);
    expect(validate({ ...good, type: "explode" })).toBe(false);
    expect(validate({ ...good, rationale: "" })).toBe(false);
  });

  it("mcp-tools.json mirrors the registry", () => {
    const manifest = readJson(join(repoRoot, "docs/generated/mcp-tools.json"));
    expect(manifest.tools).toHaveLength(TOOLS.length);
    for (const t of manifest.tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.outputSchema.type).toBe("object");
      expect(t.examples.length).toBeGreaterThanOrEqual(2);
      expect(t.description).toContain("Worked examples");
      expect(Array.isArray(t.errors)).toBe(true);
      expect(t.errors.length).toBeGreaterThan(0);
      for (const e of t.errors) {
        expect(typeof e).toBe("string");
        expect((e as string).length).toBeGreaterThan(0);
      }
    }
  });

  it("openapi.json covers the route surface", () => {
    const doc = readJson(join(repoRoot, "docs/generated/openapi.json"));
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.version).toBe(CONTRACTS_VERSION);
    const ops = Object.entries(doc.paths).flatMap(([path, item]) =>
      Object.entries(item as Record<string, unknown>).map(([method, op]) => [method, path, op]),
    );
    expect(ops.length).toBeGreaterThanOrEqual(19);
    for (const [, path, op] of ops) {
      expect((op as { responses: unknown }).responses, `${path}`).toBeDefined();
    }
  });

  it("gen:check passes: committed artifacts match the schemas", () => {
    const out = execFileSync(process.execPath, ["--import", "tsx", join(pkgRoot, "scripts/generate.ts"), "--check"], {
      cwd: pkgRoot,
      encoding: "utf8",
      stdio: "pipe",
    });
    expect(out).toContain("gen:check OK");
  }, 120000);
});
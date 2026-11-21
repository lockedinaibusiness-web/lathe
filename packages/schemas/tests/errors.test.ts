import { describe, expect, it } from "vitest";
import { ErrorCodes, type ErrorCode, errorDef, isErrorCode } from "../src/index.js";

const ERROR_CODES_KEYS = Object.keys(ErrorCodes) as (keyof typeof ErrorCodes)[];

describe("error catalog (PLG-5)", () => {
  it("every code has an HTTP status, message, and actionable fix", () => {
    for (const code of ERROR_CODES_KEYS) {
      const def = ErrorCodes[code];
      expect(typeof def.http_status, `${code} http_status`).toBe("number");
      expect(def.http_status).toBeGreaterThanOrEqual(400);
      expect(def.message.length, `${code} message`).toBeGreaterThan(5);
      expect(def.suggested_fix.length, `${code} suggested_fix`).toBeGreaterThan(10);
    }
  });

  it("covers the codes referenced by tools and routes", () => {
    for (const code of [
      "AUTH_REQUIRED",
      "SCOPE_DENIED",
      "PROJECT_NOT_FOUND",
      "BRIEF_NOT_READY",
      "SEARCH_INDEX_NOT_READY",
      "OP_TARGET_NOT_FOUND",
      "OP_SNAP_AMBIGUOUS",
      "VERSION_CONFLICT",
      "BATCH_TOO_LARGE",
      "IDEMPOTENCY_REUSED",
      "JOB_FAILED",
      "RENDER_FAILED",
      "STYLE_NOT_FOUND",
      "RATE_LIMITED",
      "VALIDATION_FAILED",
      "NOT_FOUND",
      "INTERNAL",
    ] as const) {
      expect(isErrorCode(code)).toBe(true);
      expect(errorDef(code).http_status).toBeGreaterThanOrEqual(400);
    }
  });

  it("isErrorCode rejects unknown codes and errorDef throws", () => {
    expect(isErrorCode("NOPE")).toBe(false);
    expect(() => errorDef("NOPE" as ErrorCode)).toThrow(/Unknown error code/);
  });
});
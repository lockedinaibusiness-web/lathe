import { describe, expect, it } from "vitest";
import { ROUTES, isErrorCode } from "../src/index.js";
import { z } from "zod";

describe("HTTP route contracts (PLG-2)", () => {
  it("operationIds and paths are unique", () => {
    const opIds = ROUTES.map((r) => r.operationId);
    expect(new Set(opIds).size).toBe(opIds.length);
    const paths = ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("every route declares known error codes", () => {
    for (const route of ROUTES) {
      for (const code of route.errors) {
        expect(isErrorCode(code), `${route.operationId}: ${code}`).toBe(true);
      }
    }
  });

  it("every request/response schema converts to JSON Schema", () => {
    for (const route of ROUTES) {
      z.toJSONSchema(route.response, { target: "draft-2020-12" });
      if (route.request?.body) z.toJSONSchema(route.request.body, { target: "draft-2020-12" });
      if (route.request?.params) z.toJSONSchema(route.request.params, { target: "draft-2020-12" });
      if (route.request?.query) z.toJSONSchema(route.request.query, { target: "draft-2020-12" });
    }
  });

  it("path parameters match the params schema shape", () => {
    for (const route of ROUTES) {
      const params = route.request?.params;
      if (!params) continue;
      const declared = [...route.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const shape = (params as z.ZodObject<z.ZodRawShape>).shape;
      expect(Object.keys(shape).sort(), route.path).toEqual(declared.sort());
    }
  });

  it("mutating routes require auth", () => {
    for (const route of ROUTES) {
      if (["POST", "PATCH", "PUT", "DELETE"].includes(route.method)) {
        expect(route.auth, `${route.operationId} auth`).not.toBe("none");
      }
    }
  });
});
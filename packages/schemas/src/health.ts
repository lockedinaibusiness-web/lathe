/**
 * Health/readiness contracts surfaced by the API and consumed by `pnpm dev`
 * and CI to assert the stack came up.
 */

import { z } from "zod";
import { CONTRACTS_VERSION } from "./common.js";

export const HealthResponse = z.object({
  status: z.literal("ok"),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ReadyzCheck = z.object({
  name: z.enum(["database", "storage", "queue"]),
  status: z.enum(["ok", "down"]),
  detail: z.string().max(200).optional(),
});
export type ReadyzCheck = z.infer<typeof ReadyzCheck>;

export const ReadyzResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.array(ReadyzCheck).min(1),
});
export type ReadyzResponse = z.infer<typeof ReadyzResponse>;

/** The current health payload for this contract build. */
export function healthPayload(): HealthResponse {
  return { status: "ok", version: CONTRACTS_VERSION };
}
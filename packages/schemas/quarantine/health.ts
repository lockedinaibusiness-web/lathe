import { z } from "zod";

/** GET /readyz response: dependency-by-dependency readiness. */
export const ReadyzResponse = z
  .object({
    status: z.enum(["ok", "degraded", "down"]),
    checks: z
      .array(
        z.object({
          name: z.enum(["database", "storage", "queue"]),
          status: z.enum(["ok", "down"]),
          detail: z.string().max(200).optional(),
        }),
      )
      .min(1),
  })
  .describe("Per-dependency readiness.");

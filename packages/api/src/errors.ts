import type { FastifyInstance } from "fastify";
import { errorDef, type ErrorCode as ErrorCodeValue } from "@lathe/schemas";

/** Typed application error carrying a catalog code. */
export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCodeValue,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      const def = errorDef(err.code);
      reply.code(def.http_status).send({
        error: {
          code: err.code,
          message: err.message,
          suggested_fix: def.suggested_fix,
          ...(err.details ? { details: err.details } : {}),
        },
      });
      return;
    }
    // Fastify validation/serialization errors
    const fastifyErr = err as { validation?: unknown; message?: string };
    if (fastifyErr.validation !== undefined) {
      reply.code(400).send({
        error: {
          code: "VALIDATION_FAILED",
          message: fastifyErr.message ?? "Request failed schema validation.",
          suggested_fix: errorDef("VALIDATION_FAILED").suggested_fix,
          details: { validation: fastifyErr.validation },
        },
      });
      return;
    }
    req.log.error(err, "unhandled error");
    reply.code(500).send({
      error: {
        code: "INTERNAL",
        message: "Unexpected server error.",
        suggested_fix: errorDef("INTERNAL").suggested_fix,
      },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: `No route ${req.method} ${req.url}`,
        suggested_fix: errorDef("NOT_FOUND").suggested_fix,
      },
    });
  });
}

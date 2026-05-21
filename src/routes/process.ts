/**
 * POST `/aggregator/takehome/process` — HMAC-verified settlement batch (see `processRequest`).
 */
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { processRequestSchema } from "@/schemas/process.js";
import { processRequest } from "@/services/transaction-processor.js";
import { verifyHmac } from "@/auth/hmac.js";
import { env } from "@/config/index.js";
import { InsufficientFundsError, IdempotencyConflictError, InvalidRollbackError } from "@/domain/errors.js";

const processRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post("/aggregator/takehome/process", async (request: FastifyRequest, reply: FastifyReply) => {
    const rawBody = request.rawBody ?? Buffer.alloc(0);
    const authHeader = request.headers["authorization"];

    if (!verifyHmac(rawBody, authHeader, env.HMAC_SECRET)) {
      return reply.status(403).send({ error: "Forbidden", message: "Invalid or missing HMAC signature" });
    }

    const parsed = processRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message });
    }

    try {
      const result = await processRequest(parsed.data);
      return reply.status(200).send(result);
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        return reply.status(422).send({ code: 100, message: err.message });
      }
      if (err instanceof IdempotencyConflictError) {
        return reply.status(409).send({ error: "Conflict", message: err.message });
      }
      if (err instanceof InvalidRollbackError) {
        return reply.status(409).send({ error: "Conflict", message: err.message });
      }
      throw err;
    }
  });
};

export default processRoute;

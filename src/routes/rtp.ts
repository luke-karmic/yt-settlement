/**
 * GET RTP reporting routes (`/aggregator/takehome/rtp/users` and `/casino`), HMAC on empty body.
 */
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { rtpQuerySchema } from "@/schemas/rtp.js";
import { getRtpUsers, getRtpCasino } from "@/services/rtp-aggregator.js";
import { verifyHmac } from "@/auth/hmac.js";
import { env } from "@/config/index.js";

/**
 * @param request - Incoming GET request
 * @param reply - Fastify reply used to send 403 on failure
 * @returns `true` when HMAC over an empty body matches; `false` after sending 403
 */
function verifyGetHmac(request: FastifyRequest, reply: FastifyReply): boolean {
  const authHeader = request.headers["authorization"];
  const emptyBody = Buffer.alloc(0);
  if (!verifyHmac(emptyBody, authHeader, env.HMAC_SECRET)) {
    reply.status(403).send({ error: "Forbidden", message: "Invalid or missing HMAC signature" });
    return false;
  }
  return true;
}

const rtpRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/aggregator/takehome/rtp/users", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyGetHmac(request, reply)) return;

    const parsed = rtpQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message });
    }

    const { data, total } = await getRtpUsers(parsed.data);
    return reply.send({
      data,
      pagination: {
        page: parsed.data.page,
        limit: parsed.data.limit,
        total,
      },
    });
  });

  fastify.get("/aggregator/takehome/rtp/casino", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyGetHmac(request, reply)) return;

    const parsed = rtpQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message });
    }

    const data = await getRtpCasino(parsed.data);
    return reply.send({ data });
  });
};

export default rtpRoute;

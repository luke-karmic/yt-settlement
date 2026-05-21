import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

/**
 * Fastify plugin: captures the incoming JSON body as a Buffer on `req.rawBody` for HMAC
 * verification, then parses a copy into `request.body` for route handlers.
 *
 * @returns Registered plugin that adds the `application/json` buffer parser
 */
const rawBodyPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest("rawBody", undefined);

  fastify.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    req.rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    try {
      const json = body.length > 0 ? JSON.parse(body.toString("utf8")) : {};
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });
};

export default fp(rawBodyPlugin, { name: "raw-body" });

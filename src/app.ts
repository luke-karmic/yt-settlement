import Fastify from "fastify";
import rawBodyPlugin from "@/plugins/raw-body.js";
import healthRoute from "@/routes/health.js";
import processRoute from "@/routes/process.js";
import rtpRoute from "@/routes/rtp.js";
import { buildFastifyLogger } from "@/observability/pino-options.js";

/**
 * Builds the Fastify application with raw-body HMAC support and settlement routes.
 *
 * @returns Configured Fastify instance (not listening until `listen` is called)
 */
export async function buildApp() {
  const bodyLimit = 10 * 1024 * 1024;
  const fastify = Fastify({
    loggerInstance: buildFastifyLogger(),
    bodyLimit,
  });

  await fastify.register(rawBodyPlugin);
  await fastify.register(healthRoute);
  await fastify.register(processRoute);
  await fastify.register(rtpRoute);

  return fastify;
}

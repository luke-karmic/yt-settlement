/** GET `/health` — liveness probe including Postgres connectivity. */
import type { FastifyPluginAsync } from "fastify";
import { checkDbHealth } from "@/db/client.js";

const healthRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health", async () => {
    const dbOk = await checkDbHealth();
    return { status: "ok", db: dbOk ? "ok" : "error" };
  });
};

export default healthRoute;

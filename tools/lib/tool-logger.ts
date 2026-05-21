import type { Logger } from "pino";
import { createLogger } from "@/observability/pino-options.js";
import type { SimulatorEnv } from "./simulator-env.js";

export function createToolLogger(simEnv: SimulatorEnv): Logger {
  const pretty =
    simEnv.LOG_PRETTY === true ||
    (simEnv.LOG_PRETTY !== false && simEnv.NODE_ENV === "development");

  return createLogger(simEnv.LOG_LEVEL, pretty);
}

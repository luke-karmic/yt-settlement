import pino from "pino";
import type { Logger, LoggerOptions } from "pino";
import pinoPretty from "pino-pretty";
import { env, isTest } from "@/config/index.js";

export function usePrettyLogs(): boolean {
  if (isTest) return false;
  if (process.env["LOG_PRETTY"] === "false") return false;
  if (env.LOG_PRETTY === true || process.env["LOG_PRETTY"] === "true") return true;
  return env.NODE_ENV === "development";
}

export function createPrettyStream(): pinoPretty.PrettyStream {
  return pinoPretty({
    colorize: true,
    translateTime: "SYS:standard",
    ignore: "pid,hostname",
  });
}

export function createLogger(level: string = env.LOG_LEVEL, pretty = usePrettyLogs()): Logger {
  if (isTest) {
    return pino({ level: "silent" });
  }

  if (pretty) {
    return pino({ level }, createPrettyStream());
  }

  return pino({ level });
}

export function buildFastifyLogger(): Logger {
  return createLogger();
}

export function buildPinoOptions(): LoggerOptions | false {
  if (isTest) return false;
  return { level: env.LOG_LEVEL };
}

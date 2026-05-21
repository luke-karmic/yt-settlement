import { loadEnv, type Env } from "./env.js";

export type { Env };

/** Validated process environment (loaded once at module init). */
export const env: Env = loadEnv();

/** `true` when `NODE_ENV === "production"`. */
export const isProduction = env.NODE_ENV === "production";

/** `true` when `NODE_ENV === "test"` (disables HTTP server logging in tests). */
export const isTest = env.NODE_ENV === "test";

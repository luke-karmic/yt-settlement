import postgres from "postgres";
import type { SimulatorEnv } from "./simulator-env.js";

export type ToolDb = ReturnType<typeof postgres>;

export function createToolDb(env: SimulatorEnv): ToolDb {
  return postgres(env.DATABASE_URL, { max: 5 });
}

import { z } from "zod";

const simulatorEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production", "load"]).default("development"),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((url) => url.startsWith("postgres://") || url.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a PostgreSQL connection string",
    })
    .default("postgres://yeet:yeet@localhost:5433/yeet_dev"),
  API_URL: z.string().url().default("http://localhost:3000"),
  HMAC_SECRET: z.string().min(1).default("test"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LOG_PRETTY: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  USERS: z.coerce.number().int().positive().default(20),
  ROUNDS: z.coerce.number().int().positive().default(10),
  CURRENCY: z.string().min(1).max(10).default("USD"),
  INITIAL_BALANCE: z.coerce.bigint().positive().default(1_000_000n),
  GAME: z.string().min(1).default("sim:events"),
});

export type SimulatorEnv = z.infer<typeof simulatorEnvSchema>;

export function loadSimulatorEnv(source: NodeJS.ProcessEnv = process.env): SimulatorEnv {
  const parsed = simulatorEnvSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid simulator environment:\n${detail}`);
  }
  return parsed.data;
}

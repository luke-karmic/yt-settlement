import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production", "load"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((url) => url.startsWith("postgres://") || url.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a PostgreSQL connection string",
    })
    .default("postgres://yeet:yeet@localhost:5433/yeet_dev"),
  HMAC_SECRET: z.string().min(1).default("test"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LOG_PRETTY: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof envSchema>;

function formatEnvErrors(error: z.ZodError): string {
  return error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
}

/**
 * Parses and validates environment variables required by the API and database client.
 *
 * @param source - Environment map to parse (defaults to `process.env`)
 * @returns Typed, validated configuration
 * @throws {Error} When required variables are missing or invalid
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${formatEnvErrors(parsed.error)}`);
  }
  return parsed.data;
}

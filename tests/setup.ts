import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load test env before anything else
config({ path: resolve(__dirname, "../.env.test") });

// Override DATABASE_URL for test environment
process.env["DATABASE_URL"] = process.env["DATABASE_URL"] ?? "postgres://yeet:yeet@localhost:5433/yeet_test";
process.env["HMAC_SECRET"] = "test";
process.env["NODE_ENV"] = "test";

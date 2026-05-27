/**
 * Entry shim for `pnpm reconcile` — delegates to {@link ./reconcile-balances/run.js}.
 */
import { main } from "./reconcile-balances/run.js";

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

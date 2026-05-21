import { main } from "./event-simulator/run.js";

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

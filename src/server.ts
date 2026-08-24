import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./shared/logger.js";
import { initializeStorageReadiness } from "./config/storage-readiness.js";
import { db } from "./config/firebase.js";
import { startMailWorker } from "./notifications/mail-worker.js";
await initializeStorageReadiness();
const stopMailWorker = startMailWorker(db);
const server = app.listen(env.PORT, env.HOST, () =>
  logger.info("server_started", { port: env.PORT, environment: env.APP_ENV }),
);
let closing = false;
function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info("server_shutdown", { signal });
  stopMailWorker();
  server.close((error) => {
    if (error) {
      logger.error("server_shutdown_failed", { errorType: error.name });
      process.exitCode = 1;
    }
    process.exit();
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

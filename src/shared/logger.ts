// Minimal JSON logger with the same structured-event contract used by Pino deployments.
type Level = "debug" | "info" | "warn" | "error";
const rank: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const configured = (process.env.LOG_LEVEL as Level | undefined) ?? "info";
function write(
  level: Level,
  event: string,
  fields: Record<string, unknown> = {},
) {
  if (rank[level] < rank[configured]) return;
  process.stdout.write(
    `${JSON.stringify({ level, time: Date.now(), event, ...fields })}\n`,
  );
}
export const logger = {
  debug: (e: string, f?: Record<string, unknown>) => write("debug", e, f),
  info: (e: string, f?: Record<string, unknown>) => write("info", e, f),
  warn: (e: string, f?: Record<string, unknown>) => write("warn", e, f),
  error: (e: string, f?: Record<string, unknown>) => write("error", e, f),
};

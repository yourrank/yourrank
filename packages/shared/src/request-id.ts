// Shared request ID generation and structured logging for YourRank Workers.
// Both Workers import this for consistent, grep-able log lines.
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Generate a short, unique request ID.
 * Uses crypto.randomUUID if available, falls back to Math.random.
 */
export function generateRequestId(): string {
  try {
    // crypto.randomUUID is available in Workers runtime
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  } catch {
    return Math.random().toString(36).slice(2, 18);
  }
}

const LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

type LogLevel = "debug" | "info" | "warn" | "error";

interface LoggerEnv {
  LOG_LEVEL?: string;
  LOG_SAMPLE_RATE?: string;
}

interface LogFields {
  level: LogLevel;
  worker: string;
  req_id?: string;
  msg: string;
  [key: string]: unknown;
}

export interface Logger {
  reqId: string;
  worker: string;
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, extra?: Record<string, unknown>) => void;
  debug: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface RequestMetrics {
  startedAt: number;
  dbQueries: number;
  route?: string;
  site?: string;
  cache?: "hit" | "miss" | "bypass";
  payloadBytes?: number;
}

export interface RequestDbClient {
  unsafe(text: string, params?: unknown[]): Promise<any[]>;
  end(options?: { timeout?: number }): Promise<unknown>;
}

export interface RequestDbState {
  client: RequestDbClient | null;
  inFlight: number;
  releaseRequested: boolean;
  retired: Map<RequestDbClient, number>;
}

type RequestCleanup = () => Promise<void> | void;
let requestCleanup: RequestCleanup | null = null;

export function registerRequestCleanup(cleanup: RequestCleanup): void {
  requestCleanup = cleanup;
}

export async function runRequestCleanup(): Promise<void> {
  await requestCleanup?.();
}

// Capture the original console methods before anything monkey-patches them.
const CONSOLE = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function shouldLog(level: LogLevel, env?: LoggerEnv): boolean {
  const configured = (env?.LOG_LEVEL || "info").toLowerCase();
  const minLevel = LEVELS[configured] ?? LEVELS.info;
  if (LEVELS[level] < minLevel) return false;

  // Never sample warnings or errors — they are needed for alerting.
  if (level === "warn" || level === "error") return true;
  const rate = Number(env?.LOG_SAMPLE_RATE ?? "1");
  if (Number.isNaN(rate) || rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}

export function log(fields: LogFields, env?: LoggerEnv): void {
  if (!shouldLog(fields.level, env)) return;
  const line = { ...fields, ts: new Date().toISOString() };
  if (fields.level === "error") {
    CONSOLE.error(JSON.stringify(line));
  } else if (fields.level === "warn") {
    CONSOLE.warn(JSON.stringify(line));
  } else {
    CONSOLE.log(JSON.stringify(line));
  }
}

/**
 * Create a request-scoped logger with worker + req_id pre-filled.
 * Pass `env` to honour LOG_LEVEL and LOG_SAMPLE_RATE.
 */
export function createLogger(worker: string, reqId: string, env?: LoggerEnv): Logger {
  const logger: Logger = {
    reqId,
    worker,
    info: (msg, extra) => log({ ...extra, level: "info", worker, req_id: reqId, msg }, env),
    warn: (msg, extra) => log({ ...extra, level: "warn", worker, req_id: reqId, msg }, env),
    error: (msg, extra) => log({ ...extra, level: "error", worker, req_id: reqId, msg }, env),
    debug: (msg, extra) => log({ ...extra, level: "debug", worker, req_id: reqId, msg }, env),
  };
  return logger;
}

// Per-request logger context so any helper can call getLogger() instead of
// passing a log object through every call stack.
const loggerStore = new AsyncLocalStorage<{ logger: Logger; db: RequestDbState }>();
const metricsStore = new AsyncLocalStorage<RequestMetrics>();

export function runWithLogger<T>(logger: Logger, fn: () => T): T {
  return loggerStore.run({
    logger,
    db: {
      client: null,
      inFlight: 0,
      releaseRequested: false,
      retired: new Map(),
    },
  }, () => metricsStore.run({ startedAt: Date.now(), dbQueries: 0 }, fn));
}

export function getRequestDbState(): RequestDbState | null {
  return loggerStore.getStore()?.db || null;
}

export function getLogger(): Logger {
  return loggerStore.getStore()?.logger || createLogger("unknown", "no-ctx");
}

/** Request id of the current request context, or null outside a request (cron, queue). */
export function currentCorrelationId(): string | null {
  return loggerStore.getStore()?.logger.reqId || null;
}

export function getRequestMetrics(): RequestMetrics | null {
  return metricsStore.getStore() || null;
}

export function setRequestMetrics(fields: Partial<Omit<RequestMetrics, "startedAt" | "dbQueries">>): void {
  const metrics = metricsStore.getStore();
  if (metrics) Object.assign(metrics, fields);
}

export function incrementDbQueries(): void {
  const metrics = metricsStore.getStore();
  if (metrics) metrics.dbQueries += 1;
}

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

let consoleRedirectInstalled = false;

/**
 * Redirect raw console.* calls through the request-scoped logger.
 * Safe to call multiple times; installs the patch only once.
 */
export function installConsoleRedirect(): void {
  if (consoleRedirectInstalled) return;
  consoleRedirectInstalled = true;
  console.log = (...args: unknown[]) => getLogger().info(formatConsoleArgs(args));
  console.warn = (...args: unknown[]) => getLogger().warn(formatConsoleArgs(args));
  console.error = (...args: unknown[]) => getLogger().error(formatConsoleArgs(args));
}

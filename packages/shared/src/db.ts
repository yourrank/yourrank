// ============================================================================
//  YourRank — SHARED POSTGRES DATA LAYER (TypeScript)
//
//  Consolidated postgres.js wrapper used by BOTH Workers:
//    * One postgres client is reused within each request context. Cloudflare
//      Workers cannot reuse I/O objects across request contexts, so clients
//      are released when their request finishes. Hyperdrive pools the
//      underlying DB connections.
//    * Exposes query<T>()/one<T>() for reads (retries on connection errors)
//    * Exposes exec()/execOne() for writes (NO retry — callers handle idempotency)
//    * Supports transactions via withTransaction()
//    * Retry logic, connection-error handling, and timeout tuning are centralized
//
//  QA-016: Write operations (exec/execOne) never retry automatically. Retrying
//  a non-idempotent INSERT creates duplicate rows. Callers must handle their
//  own idempotency (ON CONFLICT, deterministic IDs, or try/catch + dedup).
//
//  Replaces apps/leaderboard/src/db.js and apps/bot/src/db.ts
// ============================================================================

import postgres from "postgres";
import {
  getRequestDbState,
  incrementDbClients,
  incrementDbQueries,
  recordDbStatement,
  registerRequestCleanup,
  type RequestDbClient,
  type RequestDbState,
} from "./request-id.js";

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

function getDatabaseUrl(): string {
  // Both Workers should set process.env.DATABASE_URL before any query runs
  // - Bot Worker: sets it from config
  // - Leaderboard Worker: sets it from env.HYPERDRIVE.connectionString or env.DATABASE_URL
  if (typeof process !== "undefined" && process.env?.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  throw new Error("DATABASE_URL is not configured (set the HYPERDRIVE binding or DATABASE_URL secret)");
}

// ----------------------------------------------------------------------------
// Connection management
// ----------------------------------------------------------------------------

function createSql(): ReturnType<typeof postgres> {
  const url = getDatabaseUrl();
  incrementDbClients();
  return postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 5,
    connect_timeout: 10,
    debug: false,
  });
}

async function timed<T>(text: string, run: () => Promise<T>): Promise<T> {
  incrementDbQueries();
  const started = performance.now();
  try {
    return await run();
  } finally {
    recordDbStatement(text, performance.now() - started);
  }
}

export interface DbDependencies {
  createSql?: () => RequestDbClient;
  sleepImpl?: (ms: number) => Promise<unknown>;
}

function getCachedSql(): { sql: RequestDbClient; state: RequestDbState } | null {
  const state = getRequestDbState();
  if (!state || state.releaseRequested || state.client === null) {
    return null;
  }
  state.inFlight++;
  return { sql: state.client, state };
}

function acquireSql(create: () => RequestDbClient): {
  sql: RequestDbClient;
  state: RequestDbState | null;
  cached: boolean;
} {
  const cached = getCachedSql();
  if (cached) return { ...cached, cached: true };

  const state = getRequestDbState();
  if (!state || state.releaseRequested) {
    return { sql: create(), state: null, cached: false };
  }
  const sql = create();
  state.client = sql;
  state.inFlight = 1;
  return { sql, state, cached: true };
}

function retireCachedSql(state: RequestDbState, sql: RequestDbClient): void {
  if (state.client !== sql) return;
  state.client = null;
  state.retired.set(sql, state.inFlight);
  state.inFlight = 0;
}

async function endSql(sql: RequestDbClient): Promise<void> {
  await sql.end({ timeout: 0 }).catch(() => {});
}

async function releaseSql(
  sql: RequestDbClient,
  state: RequestDbState | null,
  cached: boolean,
): Promise<void> {
  if (!state || !cached) {
    await endSql(sql);
    return;
  }
  if (state.client === sql) {
    state.inFlight--;
    if (state.releaseRequested && state.inFlight === 0) {
      state.client = null;
      await endSql(sql);
    }
    return;
  }
  const remaining = (state.retired.get(sql) || 1) - 1;
  if (remaining <= 0) {
    state.retired.delete(sql);
    await endSql(sql);
  } else {
    state.retired.set(sql, remaining);
  }
}

function discardSql(sql: RequestDbClient, state: RequestDbState | null, cached: boolean): void {
  if (!state || !cached) return;
  retireCachedSql(state, sql);
}

export async function releaseRequestDbClient(): Promise<void> {
  const state = getRequestDbState();
  if (!state) return;
  state.releaseRequested = true;
  if (state.client && state.inFlight === 0) {
    const sql = state.client;
    state.client = null;
    await endSql(sql);
  }
}

registerRequestCleanup(releaseRequestDbClient);

// Deprecated helper; creates a new sql client. Callers are responsible for
// calling sql.end() when done. Prefer withTransaction() for transactions.
export function getSql(): ReturnType<typeof postgres> {
  return createSql();
}

// ----------------------------------------------------------------------------
// Retry / error helpers
// ----------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isConnError(e: any): boolean {
  const code = String(e?.code ?? "");
  const msg = String(e?.message || e);
  return (
    /^(ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EPIPE|ECONNABORTED)$/.test(code) ||
    /ECONNRESET|ENOTFOUND|ETIMEDOUT|connection|socket|closed|EOF|network/i.test(msg)
  );
}

function isStatementTimeout(e: any): boolean {
  return String(e?.code ?? "") === "57014" ||
    /statement timeout|canceling statement due to statement timeout/i.test(String(e?.message || e));
}

// ----------------------------------------------------------------------------
// Public API - reads (safe to retry)
// ----------------------------------------------------------------------------

/** Execute a SQL read query with automatic retry on connection errors. */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
  dependencies: DbDependencies = {},
): Promise<T[]> {
  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sql, state, cached } = acquireSql(dependencies.createSql ?? createSql);
    try {
      const rows = await timed(text, () => sql.unsafe(text, params as any[]));
      return rows.map((r: any) => ({ ...r })) as unknown as T[];
    } catch (e: any) {
      lastErr = e;
      if (isStatementTimeout(e)) throw e;
      const msg = String(e?.message || e);
      // Don't retry on constraint violations - these are application errors
      if (/23505|23514|23503|23502|23P01/.test(msg)) throw e;
      if (isConnError(e)) discardSql(sql, state, cached);
      if (attempt < 2) await (dependencies.sleepImpl ?? sleep)(200 * (attempt + 1));
    } finally {
      await releaseSql(sql, state, cached);
    }
  }
  throw lastErr;
}

/**
 * Execute one read inside a short transaction-local timeout.
 *
 * Hyperdrive uses transaction pooling, so SET LOCAL is scoped to the same
 * pooled connection as the read and is reset on COMMIT/ROLLBACK. Keeping this
 * to one statement avoids holding an origin connection across multiple reads.
 */
export async function queryWithTimeout<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
  timeoutMs = 5000
): Promise<T[]> {
  const timeout = Math.max(1, Math.floor(timeoutMs));
  return withTransaction(async (tx) => {
    await tx.query(`SET LOCAL statement_timeout = '${timeout}ms'`);
    return tx.query<T>(text, params);
  });
}

/** Execute a SQL read query and return the first row, or undefined if no rows. */
export async function one<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
  dependencies: DbDependencies = {},
): Promise<T | undefined> {
  const rows = await query<T>(text, params, dependencies);
  return rows[0];
}

// ----------------------------------------------------------------------------
// Public API - writes (NO automatic retry)
//
// QA-016: exec() and execOne() execute exactly ONCE. If the connection drops
// mid-write, the error propagates to the caller immediately. This prevents
// duplicate rows from retried INSERTs and double-applied UPDATEs.
//
// Callers of INSERT/UPDATE/DELETE are responsible for their own idempotency:
//   - Use ON CONFLICT (UPSERT) for inserts that may be retried at the app level
//   - Wrap multi-statement mutations in withTransaction()
//   - Use deterministic IDs (UUIDs generated client-side) where possible
//
// Reads (query/one) ARE safe to retry and use query() above.
// ----------------------------------------------------------------------------

/** Execute a single SQL write statement. NO retry on connection errors. */
export async function exec(
  text: string,
  params: unknown[] = [],
  dependencies: DbDependencies = {},
): Promise<any> {
  const { sql, state, cached } = acquireSql(dependencies.createSql ?? createSql);
  try {
    const rows = await timed(text, () => sql.unsafe(text, params as any[]));
    return rows.map((r: any) => ({ ...r }));
  } catch (e: any) {
    if (isConnError(e)) discardSql(sql, state, cached);
    throw e;
  } finally {
    await releaseSql(sql, state, cached);
  }
}

// ----------------------------------------------------------------------------
// Transaction support
// ----------------------------------------------------------------------------

/**
 * A transaction-scoped handle. Mirrors query()/one() so callers use the same
 * shape, but every statement runs on the SAME connection inside one
 * BEGIN/COMMIT. postgres.js drives the transaction boundary for us.
 */
export interface Tx {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | undefined>;
  unsafe(text: string, params?: unknown[]): Promise<any[]>;
  /** Run `fn` under a SAVEPOINT: a throw rolls back only `fn`'s statements and re-throws. */
  savepoint?<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

function wrapTx(sqlTx: any): Tx {
  return {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
      const rows = (await timed(text, () => sqlTx.unsafe(text, params as any[]))) as unknown[];
      return rows.map((r) => ({ ...(r as Record<string, unknown>) })) as unknown as T[];
    },
    async one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | undefined> {
      const rows = (await timed(text, () => sqlTx.unsafe(text, params as any[]))) as unknown[];
      return rows[0] ? ({ ...(rows[0] as Record<string, unknown>) } as T) : undefined;
    },
    async unsafe(text: string, params: unknown[] = []) {
      const rows = (await timed(text, () => sqlTx.unsafe(text, params as any[]))) as any[];
      return rows.map((r) => ({ ...r }));
    },
    savepoint<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return sqlTx.savepoint((inner: any) => fn(wrapTx(inner))) as Promise<T>;
    },
  };
}

/**
 * Run `fn` inside a database transaction. Commits on success, rolls back on
 * any throw — postgres.js drives both automatically via sql.begin(callback).
 * Use this for multi-statement writes that must all land or none land (e.g.
 * recording a payment + activating a plan).
 *
 * Note: no in-band retry here (unlike query()). A retry mid-transaction would
 * be unsafe — the caller must decide whether re-running the whole unit is OK.
 */
export async function withTransaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
  // Retry up to 3 times on connection-level errors (dropped Hyperdrive connections,
  // ECONNRESET, etc.). Unlike query() which retries each statement independently,
  // we only retry the INITIAL connection attempt — once BEGIN is issued and fn()
  // starts running, any error propagates immediately.
  for (let attempt = 0; attempt < 3; attempt++) {
    const sql = createSql();
    try {
      const result = await sql.begin((sqlTx: any) => fn(wrapTx(sqlTx)));
      return result as unknown as R;
    } catch (err) {
      if (isConnError(err) && attempt < 2) {
        await sleep(200 * (attempt + 1));
        continue;
      }
      throw err;
    } finally {
      await sql.end({ timeout: 0 }).catch(() => {});
    }
  }
  // TypeScript requires a return here; the loop always throws or returns above.
  throw new Error("withTransaction: exhausted retries");
}

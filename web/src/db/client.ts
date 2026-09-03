import { installBuiltins } from "./registry";
import { connect, type Connection, type Executor } from "./connection";

export type { Connection, Executor } from "./connection";

/**
 * Prepare one connection for the application. Connection setup owns the
 * resource until both schema migration and builtin registration succeed.
 */
export async function prepare(connection: Connection): Promise<Executor> {
  try {
    await connection.migrate();
    await installBuiltins(connection.db);
  } catch (error) {
    await connection.close();
    throw error;
  }
  return connection.db;
}

async function open(): Promise<Executor> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  return prepare(await connect(url));
}

/**
 * A connection outlives hot-reloaded server modules. The process owns the
 * pool, so its promise lives on the runtime and a failed open remains retryable.
 */
interface DatabaseHandle {
  ready?: Promise<Executor>;
}

const HANDLE: unique symbol = Symbol.for("vitroflow.database");
const runtime = globalThis as typeof globalThis & {
  [HANDLE]?: DatabaseHandle;
};
const handle: DatabaseHandle = (runtime[HANDLE] ??= {});

/** The migrated application database with its builtin models, opened on first use. */
export function database(): Promise<Executor> {
  handle.ready ??= open().catch((error: unknown) => {
    handle.ready = undefined;
    throw error;
  });
  return handle.ready;
}

/** Run work inside one transaction on the application database. */
export async function transaction<T>(
  work: (tx: Executor) => Promise<T>,
): Promise<T> {
  const db = await database();
  return db.transaction((tx) => work(tx));
}

/** Join an existing unit of work or open one for a standalone domain call. */
export function inTransaction<T>(
  executor: Executor | undefined,
  work: (tx: Executor) => Promise<T>,
): Promise<T> {
  return executor ? work(executor) : transaction(work);
}

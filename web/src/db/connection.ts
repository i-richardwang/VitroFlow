import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as schema from "./schema";

/** A database handle or a transaction on it; modules never depend on the driver. */
export type Executor = PgDatabase<PgQueryResultHKT, typeof schema>;

const PGLITE_URL = "pglite://";
const MIGRATIONS_FOLDER = `${process.cwd()}/drizzle`;
const POOL_SIZE = 10;

/** A driver's open database together with the operations only it can perform. */
export interface Connection {
  db: Executor;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
}

/** Open the database URL without migrating or installing application data. */
export async function connect(url: string): Promise<Connection> {
  if (url.startsWith(PGLITE_URL)) {
    // PGlite is a development dependency; production images never load it.
    const [{ drizzle }, { migrate }] = await Promise.all([
      import("drizzle-orm/pglite"),
      import("drizzle-orm/pglite/migrator"),
    ]);
    const dataDir = url.slice(PGLITE_URL.length);
    const db = dataDir
      ? drizzle({ connection: { dataDir }, schema })
      : drizzle({ schema });
    return {
      db,
      migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
      close: () => db.$client.close(),
    };
  }
  const client = postgres(url, { max: POOL_SIZE, onnotice: () => {} });
  const db = drizzlePostgres(client, { schema });
  return {
    db,
    migrate: () => migratePostgres(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => client.end(),
  };
}

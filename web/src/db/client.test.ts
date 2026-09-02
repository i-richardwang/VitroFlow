import { describe, expect, test } from "bun:test";

import { database, prepare, type Connection } from "./client";

describe("preparing a connection", () => {
  test("serves the database once it is migrated", async () => {
    const db = await database();
    const connection: Connection = {
      db,
      migrate: () => Promise.resolve(),
      close: () =>
        Promise.reject(new Error("A prepared connection stays open")),
    };
    expect(await prepare(connection)).toBe(db);
  });

  test("releases the connection it cannot migrate", async () => {
    let closed = false;
    const connection: Connection = {
      db: await database(),
      migrate: () => Promise.reject(new Error("Migration failed")),
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    };
    await expect(prepare(connection)).rejects.toThrow("Migration failed");
    expect(closed).toBe(true);
  });
});

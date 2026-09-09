import { expect, test } from "bun:test";

test("the process database opens lazily, shares concurrent initialization, retries failures, and closes once", async () => {
  // A separate process exercises the runtime handle without replacing the suite's database.
  const process = Bun.spawn({
    cmd: [
      Bun.which("bun")!,
      "--eval",
      `
        const { configureDatabase, database, closeDatabase } = await import("./src/server/infra/db/client.ts");
        let opened = 0;
        let closed = 0;
        configureDatabase(async () => {
          if (++opened === 1) throw new Error("connection unavailable");
          return { db: {}, migrate: async () => {}, close: async () => { closed++; } };
        });
        const lazy = opened === 0;
        let retried = false;
        try { await database(); } catch { retried = true; }
        const [first, second] = await Promise.all([database(), database()]);
        await closeDatabase();
        await closeDatabase();
        const next = await database();
        await closeDatabase();
        console.log(JSON.stringify({ lazy, retried, shared: first === second, reopened: next !== first, opened, closed }));
      `,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(JSON.parse(stdout)).toEqual({
    lazy: true,
    retried: true,
    shared: true,
    reopened: true,
    opened: 3,
    closed: 2,
  });
});

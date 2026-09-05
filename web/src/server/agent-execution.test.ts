import { describe, expect, test } from "bun:test";

import { executeAgentOperation } from "./agent-execution";
import { baselineVersion } from "./testing";

describe("agent execution", () => {
  test("a command that fails leaves nothing behind", async () => {
    const version = await baselineVersion();
    const name = `Partial ${crypto.randomUUID()}`;
    const result = await executeAgentOperation("create-experiment", {
      name,
      inoculatedOn: "2026-09-01",
      modelVersionId: "not-a-model",
    });
    expect(result).toMatchObject({ ok: false, code: "not_found" });

    const created = await executeAgentOperation("create-experiment", {
      name,
      inoculatedOn: "2026-09-01",
      modelVersionId: version.id,
    });
    expect(created.ok).toBe(true);
  });

  test("a repeated command is refused by the record it would duplicate", async () => {
    const version = await baselineVersion();
    const input = {
      name: `Twice ${crypto.randomUUID()}`,
      inoculatedOn: "2026-09-01",
      modelVersionId: version.id,
    };
    expect((await executeAgentOperation("create-experiment", input)).ok).toBe(
      true,
    );
    expect(
      await executeAgentOperation("create-experiment", input),
    ).toMatchObject({ ok: false, code: "conflict" });
  });
});

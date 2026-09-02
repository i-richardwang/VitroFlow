import { describe, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";

import { database } from "../db/client";
import { agentAuditEvents, agentRequests } from "../db/schema";
import { executeAgentOperation } from "./agent-execution";
import type { ProgrammaticPrincipal } from "./programmatic-access";
import { baselineVersion } from "./testing";

const principal: ProgrammaticPrincipal = {
  kind: "api_key",
  userId: "agent-execution-user",
  credentialId: "agent-execution-key",
};

describe("agent execution", () => {
  test("mutations require a UUID idempotency key", async () => {
    const version = await baselineVersion();
    const result = await executeAgentOperation(
      "create-experiment",
      {
        name: "Missing idempotency",
        inoculatedOn: "2026-09-01",
        modelVersionId: version.id,
      },
      principal,
      null,
    );
    expect(result).toEqual({
      ok: false,
      status: 400,
      message: "Idempotency-Key must be a UUID for mutation operations",
    });
  });

  test("a repeated mutation returns one result and records one audit event", async () => {
    const version = await baselineVersion();
    const key = crypto.randomUUID();
    const input = {
      name: `Idempotent ${key}`,
      inoculatedOn: "2026-09-01",
      modelVersionId: version.id,
    };
    const first = await executeAgentOperation(
      "create-experiment",
      input,
      principal,
      key,
    );
    const repeated = await executeAgentOperation(
      "create-experiment",
      input,
      principal,
      key,
    );
    expect(first.ok).toBe(true);
    expect(repeated).toEqual(first);

    const db = await database();
    const requests = await db
      .select({ id: agentRequests.id })
      .from(agentRequests)
      .where(eq(agentRequests.idempotencyKey, key));
    const [events] = await db
      .select({ total: count() })
      .from(agentAuditEvents)
      .where(eq(agentAuditEvents.requestId, requests[0]!.id));
    expect(requests).toHaveLength(1);
    expect(events?.total).toBe(1);

    const conflict = await executeAgentOperation(
      "create-experiment",
      { ...input, name: `${input.name} changed` },
      principal,
      key,
    );
    expect(conflict).toMatchObject({ ok: false, status: 409 });
  });

  test("failed mutations leave no idempotency or audit record", async () => {
    const key = crypto.randomUUID();
    const result = await executeAgentOperation(
      "create-experiment",
      {
        name: "Unknown model",
        inoculatedOn: "2026-09-01",
        modelVersionId: "not-a-model",
      },
      principal,
      key,
    );
    expect(result).toMatchObject({ ok: false, status: 404 });
    const db = await database();
    const [requests] = await db
      .select({ total: count() })
      .from(agentRequests)
      .where(eq(agentRequests.idempotencyKey, key));
    expect(requests?.total).toBe(0);
  });
});

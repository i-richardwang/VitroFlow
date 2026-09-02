import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { transaction } from "../db/client";
import { agentAuditEvents, agentRequests } from "../db/schema";
import type { ProgrammaticPrincipal } from "./programmatic-access";
import {
  type AgentCallResult,
  type AgentOperation,
  agentOperations,
} from "./agent-operations";

const idempotencyKeySchema = z.string().uuid();

const storedResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), output: z.unknown() }),
  z.object({
    ok: z.literal(false),
    status: z.union([
      z.literal(400),
      z.literal(404),
      z.literal(409),
      z.literal(500),
    ]),
    message: z.string(),
  }),
]);

class RollbackOutcome extends Error {
  constructor(readonly outcome: AgentCallResult) {
    super("Agent operation did not complete");
  }
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function requestHash(operation: string, input: unknown): string {
  return createHash("sha256")
    .update(canonicalJson({ operation, input }))
    .digest("hex");
}

function invalidIdempotencyKey(): AgentCallResult {
  return {
    ok: false,
    status: 400,
    message: "Idempotency-Key must be a UUID for mutation operations",
  };
}

/** Execute one authenticated programmatic operation. */
export async function executeAgentOperation(
  name: string,
  input: unknown,
  principal: ProgrammaticPrincipal,
  idempotencyKey: string | null,
  registry: ReadonlyMap<string, AgentOperation> = agentOperations,
): Promise<AgentCallResult> {
  const operation = registry.get(name);
  if (!operation) {
    return {
      ok: false,
      status: 404,
      message: `Unknown operation: ${name}. Known operations: ${[...registry.keys()].join(", ")}`,
    };
  }

  const parsed = operation.input.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      message: z.prettifyError(parsed.error),
    };
  }
  if (operation.effect === "read") {
    return operation.run(parsed.data);
  }

  const key = idempotencyKeySchema.safeParse(idempotencyKey);
  if (!key.success) return invalidIdempotencyKey();
  const hash = requestHash(name, parsed.data);

  try {
    return await transaction(async (tx) => {
      const now = new Date();
      const [reservation] = await tx
        .insert(agentRequests)
        .values({
          principalKind: principal.kind,
          credentialId: principal.credentialId,
          userId: principal.userId,
          idempotencyKey: key.data,
          operation: name,
          requestHash: hash,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: agentRequests.id });

      if (!reservation) {
        const [existing] = await tx
          .select({
            operation: agentRequests.operation,
            requestHash: agentRequests.requestHash,
            response: agentRequests.response,
          })
          .from(agentRequests)
          .where(
            and(
              eq(agentRequests.principalKind, principal.kind),
              eq(agentRequests.credentialId, principal.credentialId),
              eq(agentRequests.idempotencyKey, key.data),
            ),
          );
        if (
          !existing ||
          existing.operation !== name ||
          existing.requestHash !== hash
        ) {
          throw new RollbackOutcome({
            ok: false,
            status: 409,
            message: "Idempotency-Key is already bound to another request",
          });
        }
        const stored = storedResultSchema.safeParse(existing.response);
        if (!stored.success)
          throw new Error("Idempotent response is incomplete");
        return stored.data;
      }

      const outcome = await operation.run(parsed.data, tx);
      if (!outcome.ok) throw new RollbackOutcome(outcome);

      await tx.insert(agentAuditEvents).values({
        principalKind: principal.kind,
        credentialId: principal.credentialId,
        userId: principal.userId,
        requestId: reservation.id,
        operation: name,
        input: parsed.data,
        output: outcome.output,
        occurredAt: now,
      });
      await tx
        .update(agentRequests)
        .set({ response: outcome, completedAt: new Date() })
        .where(eq(agentRequests.id, reservation.id));
      return outcome;
    });
  } catch (error) {
    if (error instanceof RollbackOutcome) return error.outcome;
    console.error(`Agent execution ${name} failed:`, error);
    return { ok: false, status: 500, message: "Internal error" };
  }
}

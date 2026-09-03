import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { transaction, type Executor } from "../db/client";
import { agentExecutions } from "../db/schema";
import { ConflictError, NotFoundError } from "../experiments/errors";
import { canonicalJson } from "../json/canonical";
import type { ProgrammaticPrincipal } from "./programmatic-access";
import { type AgentOperation, agentOperations } from "./agent-operations";

export type AgentFailureCode =
  "invalid_request" | "not_found" | "conflict" | "internal_error";

export type AgentCallResult =
  | { ok: true; output: unknown }
  | { ok: false; code: AgentFailureCode; message: string };

interface PreparedOperation {
  operation: AgentOperation;
  input: unknown;
}

const idempotencyKeySchema = z.string().uuid();
const storedResponseSchema = z.strictObject({ output: z.unknown() });

class AbortAgentExecution extends Error {
  constructor(readonly result: AgentCallResult) {
    super("Agent command did not complete");
  }
}

function failure(code: AgentFailureCode, message: string): AgentCallResult {
  return { ok: false, code, message };
}

function prepareOperation(
  name: string,
  input: unknown,
  registry: ReadonlyMap<string, AgentOperation>,
): PreparedOperation | AgentCallResult {
  const operation = registry.get(name);
  if (!operation) {
    return failure(
      "not_found",
      `Unknown operation: ${name}. Known operations: ${[...registry.keys()].join(", ")}`,
    );
  }
  const parsed = operation.input.safeParse(input);
  return parsed.success
    ? { operation, input: parsed.data }
    : failure("invalid_request", z.prettifyError(parsed.error));
}

async function invokeOperation(
  prepared: PreparedOperation,
  executor?: Executor,
): Promise<AgentCallResult> {
  const { operation, input } = prepared;
  try {
    const value = (await operation.handler(input, executor)) ?? null;
    return { ok: true, output: operation.output.parse(value) };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return failure("not_found", error.message);
    }
    if (error instanceof ConflictError) {
      return failure("conflict", error.message);
    }
    console.error(`Agent operation ${operation.name} failed:`, error);
    return failure("internal_error", "Internal error");
  }
}

function requestHash(operation: string, input: unknown): string {
  return createHash("sha256")
    .update(canonicalJson({ operation, input }))
    .digest("hex");
}

/** Execute one authenticated programmatic operation. */
export async function executeAgentOperation(
  name: string,
  input: unknown,
  principal: ProgrammaticPrincipal,
  idempotencyKey: string | null,
  registry: ReadonlyMap<string, AgentOperation> = agentOperations,
): Promise<AgentCallResult> {
  const prepared = prepareOperation(name, input, registry);
  if ("ok" in prepared) return prepared;
  if (prepared.operation.kind === "query") {
    return invokeOperation(prepared);
  }

  const key = idempotencyKeySchema.safeParse(idempotencyKey);
  if (!key.success) {
    return failure(
      "invalid_request",
      "Idempotency-Key must be a UUID for command operations",
    );
  }
  const hash = requestHash(name, prepared.input);

  try {
    return await transaction(async (tx) => {
      const now = new Date();
      const [reservation] = await tx
        .insert(agentExecutions)
        .values({
          principalKind: principal.kind,
          credentialId: principal.credentialId,
          userId: principal.userId,
          idempotencyKey: key.data,
          operation: name,
          requestHash: hash,
          input: prepared.input,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: agentExecutions.id });

      if (!reservation) {
        const [existing] = await tx
          .select({
            operation: agentExecutions.operation,
            requestHash: agentExecutions.requestHash,
            response: agentExecutions.response,
          })
          .from(agentExecutions)
          .where(
            and(
              eq(agentExecutions.principalKind, principal.kind),
              eq(agentExecutions.credentialId, principal.credentialId),
              eq(agentExecutions.idempotencyKey, key.data),
            ),
          );
        if (
          !existing ||
          existing.operation !== name ||
          existing.requestHash !== hash
        ) {
          throw new AbortAgentExecution(
            failure(
              "conflict",
              "Idempotency-Key is already bound to another request",
            ),
          );
        }
        const stored = storedResponseSchema.safeParse(existing.response);
        if (!stored.success) {
          throw new Error("Idempotent response is incomplete");
        }
        return { ok: true, output: stored.data.output };
      }

      const result = await invokeOperation(prepared, tx);
      if (!result.ok) throw new AbortAgentExecution(result);

      await tx
        .update(agentExecutions)
        .set({ response: { output: result.output }, completedAt: new Date() })
        .where(eq(agentExecutions.id, reservation.id));
      return result;
    });
  } catch (error) {
    if (error instanceof AbortAgentExecution) return error.result;
    console.error(`Agent execution ${name} failed:`, error);
    return failure("internal_error", "Internal error");
  }
}

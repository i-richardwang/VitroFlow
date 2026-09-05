import { z } from "zod";

import { transaction, type Executor } from "../db/client";
import { ConflictError, NotFoundError } from "../experiments/errors";
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
  { operation, input }: PreparedOperation,
  executor?: Executor,
): Promise<AgentCallResult> {
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

/**
 * Executes one authenticated programmatic operation. The input is parsed
 * once, a command runs in one transaction, and the output is checked against
 * the operation's published contract before it leaves.
 */
export async function executeAgentOperation(
  name: string,
  input: unknown,
  registry: ReadonlyMap<string, AgentOperation> = agentOperations,
): Promise<AgentCallResult> {
  const prepared = prepareOperation(name, input, registry);
  if ("ok" in prepared) return prepared;
  return prepared.operation.kind === "query"
    ? invokeOperation(prepared)
    : transaction((tx) => invokeOperation(prepared, tx));
}

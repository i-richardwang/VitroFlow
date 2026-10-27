import type { z } from "zod";
import type { Executor } from "../infra/db/client";
/**
 * One protocol-neutral application operation. HTTP status codes and MCP tool
 * annotations are adapter concerns; the catalog says only whether an
 * operation reads or changes state and whether that change is destructive.
 */
export interface AgentOperation {
  name: string;
  description: string;
  kind: "query" | "command";
  destructive: boolean;
  transactional?: boolean;
  input: z.ZodType;
  output: z.ZodType;
  handler: (input: unknown, executor?: Executor) => Promise<unknown>;
}

interface OperationDefinition<
  Input extends z.ZodType,
  Output extends z.ZodType,
> {
  name: string;
  description: string;
  transactional?: boolean;
  input: Input;
  output: Output;
  handler: (
    input: z.output<Input>,
    executor?: Executor,
    // biome-ignore lint/suspicious/noConfusingVoidType: a command answering `done` resolves to nothing, which execution reads as null
  ) => Promise<z.input<Output> | void>;
}

function defineOperation<Input extends z.ZodType, Output extends z.ZodType>(
  kind: AgentOperation["kind"],
  destructive: boolean,
  config: OperationDefinition<Input, Output>,
): AgentOperation {
  const { name, description, input, output, handler } = config;
  return {
    name,
    description,
    kind,
    destructive,
    transactional: config.transactional ?? true,
    input,
    output,
    handler: (value, executor) => handler(value as z.output<Input>, executor),
  };
}

export function query<Input extends z.ZodType, Output extends z.ZodType>(
  config: OperationDefinition<Input, Output>,
): AgentOperation {
  return defineOperation("query", false, config);
}

export function command<Input extends z.ZodType, Output extends z.ZodType>(
  config: OperationDefinition<Input, Output> & { destructive: boolean },
): AgentOperation {
  const { destructive, ...definition } = config;
  return defineOperation("command", destructive, definition);
}

import {
  type AgentOperation,
  agentOperations,
  describeAgentOperations,
} from "./agent-operations";
import { executeAgentOperation } from "./agent-execution";
import { authorizeApiKey } from "./api-keys";
import type { ProgrammaticPrincipal } from "./programmatic-access";

function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export async function agentApiPrincipal(
  request: Request,
): Promise<ProgrammaticPrincipal | Response> {
  return (await authorizeApiKey(request, "agent")) ?? unauthorized();
}

export async function handleAgentOperationCall(
  operation: string,
  request: Request,
  principal: ProgrammaticPrincipal,
  registry: ReadonlyMap<string, AgentOperation> = agentOperations,
): Promise<Response> {
  let input: unknown = {};
  const body = await request.text();
  if (body) {
    try {
      input = JSON.parse(body);
    } catch {
      return Response.json(
        { error: "Request body must be JSON" },
        { status: 400 },
      );
    }
  }
  const outcome = await executeAgentOperation(
    operation,
    input,
    principal,
    request.headers.get("idempotency-key"),
    registry,
  );
  return outcome.ok
    ? Response.json({ result: outcome.output })
    : Response.json({ error: outcome.message }, { status: outcome.status });
}

export async function serveAgentOperationCall(
  operation: string,
  request: Request,
): Promise<Response> {
  const principal = await agentApiPrincipal(request);
  return principal instanceof Response
    ? principal
    : handleAgentOperationCall(operation, request, principal);
}

export function describeAgentInterface(): Response {
  return Response.json({
    call: "POST /api/agent/<name> with the operation's JSON input",
    idempotency:
      "Mutation calls require an Idempotency-Key header containing a UUID",
    upload:
      "POST image bytes to /api/agent/images to obtain the digest assign-images-to-observation expects",
    operations: describeAgentOperations(),
  });
}

export async function serveAgentInterface(request: Request): Promise<Response> {
  const principal = await agentApiPrincipal(request);
  return principal instanceof Response ? principal : describeAgentInterface();
}

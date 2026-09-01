import {
  type AgentOperation,
  agentOperations,
  callAgentOperation,
  describeAgentOperations,
} from "./agent-operations";

export async function handleAgentOperationCall(
  operation: string,
  request: Request,
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
  const outcome = await callAgentOperation(operation, input, registry);
  return outcome.ok
    ? Response.json({ result: outcome.output })
    : Response.json({ error: outcome.message }, { status: outcome.status });
}

export function describeAgentInterface(): Response {
  return Response.json({
    call: "POST /api/agent/<name> with the operation's JSON input",
    upload:
      "POST image bytes to /api/agent/images to obtain the digest assign-images-to-observation expects",
    operations: describeAgentOperations(),
  });
}

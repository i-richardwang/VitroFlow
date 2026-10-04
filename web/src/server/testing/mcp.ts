const meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};

/** A request in the MCP 2026-07-28 shape, optionally carrying a bearer token. */
export function modernRequest(
  url: string,
  method: string,
  params?: Record<string, unknown>,
  token?: string,
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      host: new URL(url).host,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-method": method,
      ...(method === "tools/call" && typeof params?.name === "string"
        ? { "mcp-name": params.name }
        : {}),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { ...params, _meta: meta },
    }),
  });
}

/** A stateless Streamable HTTP request using the 2025-06-18 lifecycle. */
export function legacyRequest(
  url: string,
  method: string,
  params?: Record<string, unknown>,
  token?: string,
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      host: new URL(url).host,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(method === "initialize"
        ? {}
        : { "mcp-protocol-version": "2025-06-18" }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...(method.startsWith("notifications/") ? {} : { id: 1 }),
      method,
      ...(params === undefined ? {} : { params }),
    }),
  });
}

export const requestEras = [
  ["2026-07-28", modernRequest],
  ["2025-06-18", legacyRequest],
] as const;

/** The last JSON-RPC message of a JSON or event-stream response. */
export async function rpcMessage(response: Response): Promise<{
  // biome-ignore lint/suspicious/noExplicitAny: a result has the shape of whichever method was called; tests read it directly
  result?: any;
  error?: { message: string };
}> {
  const body = await response.text();
  const payloads = body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  return payloads.at(-1) ?? JSON.parse(body);
}

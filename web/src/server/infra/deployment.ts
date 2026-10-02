import type { McpServerName } from "../../domain/auth/integrations";

interface DeploymentEndpoint {
  origin: string;
  hostname: string;
  /** Each MCP server's canonical URL, which its access tokens are bound to. */
  mcpResources: Record<McpServerName, string>;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

/** The canonical public endpoint of this workbench deployment. */
export function deploymentEndpoint(): DeploymentEndpoint {
  const configured = process.env.BETTER_AUTH_URL;
  if (!configured) {
    throw new Error("BETTER_AUTH_URL is required");
  }
  const url = new URL(configured);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "BETTER_AUTH_URL must be an origin without credentials, path, query, or fragment",
    );
  }
  if (url.protocol !== "https:" && !isLoopback(url.hostname)) {
    throw new Error(
      "BETTER_AUTH_URL must use HTTPS outside loopback development",
    );
  }
  return {
    origin: url.origin,
    hostname: url.hostname,
    mcpResources: {
      experiments: `${url.origin}/api/experiments/mcp`,
      annotation: `${url.origin}/api/annotation/mcp`,
    },
  };
}

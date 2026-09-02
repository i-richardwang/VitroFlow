export interface DeploymentEndpoint {
  origin: string;
  hostname: string;
  mcpResource: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
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
  const configured = required("BETTER_AUTH_URL");
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
    mcpResource: `${url.origin}/api/mcp`,
  };
}

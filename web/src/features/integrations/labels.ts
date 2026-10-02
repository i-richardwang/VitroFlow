import { m } from "../../paraglide/messages";
import type { ApiScope, McpServerName } from "../../domain/auth/integrations";

export const API_SCOPE_LABELS: Record<ApiScope, () => string> = {
  agent: m.api_key_scope_agent,
  transfer: m.api_key_scope_transfer,
};

export const MCP_SERVER_LABELS: Record<McpServerName, () => string> = {
  experiments: m.mcp_server_experiments,
  annotation: m.mcp_server_annotation,
};

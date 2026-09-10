import { m } from "../../paraglide/messages";
import type { ApiScope } from "../../domain/auth/integrations";

export const API_SCOPE_LABELS: Record<ApiScope, () => string> = {
  agent: m.api_key_scope_agent,
  transfer: m.api_key_scope_transfer,
};

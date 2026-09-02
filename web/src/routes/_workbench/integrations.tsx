import { createFileRoute } from "@tanstack/react-router";

import { ApiKeysWidget } from "../../components/integrations/ApiKeysWidget";
import { McpClientsWidget } from "../../components/integrations/McpClientsWidget";
import { Page } from "../../components/Page";
import { getIntegrations } from "../../functions/integrations";

export const Route = createFileRoute("/_workbench/integrations")({
  loader: () => getIntegrations(),
  staticData: { crumbs: [{ label: "Integrations" }] },
  head: () => ({ meta: [{ title: "Integrations · VitroFlow" }] }),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const { apiKeys, mcpClients, mcpUrl } = Route.useLoaderData();

  return (
    <Page
      title="Integrations"
      description="Programs that act as you: API keys for the HTTP surfaces and MCP clients you have authorized."
    >
      <ApiKeysWidget apiKeys={apiKeys} />
      <McpClientsWidget mcpClients={mcpClients} mcpUrl={mcpUrl} />
    </Page>
  );
}

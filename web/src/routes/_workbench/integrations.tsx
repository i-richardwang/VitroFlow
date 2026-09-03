import { Button } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ApiKeysTable } from "../../components/integrations/ApiKeysTable";
import { CopyableCode } from "../../components/integrations/CopyableCode";
import { McpClientsTable } from "../../components/integrations/McpClientsTable";
import { NewApiKeyDialog } from "../../components/integrations/NewApiKeyDialog";
import { Page, PageSection } from "../../components/Page";
import { getIntegrations } from "../../functions/integrations";

export const Route = createFileRoute("/_workbench/integrations")({
  loader: () => getIntegrations(),
  staticData: { crumbs: [{ label: "Integrations" }] },
  head: () => ({ meta: [{ title: "Integrations · VitroFlow" }] }),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const { apiKeys, mcpClients, mcpUrl } = Route.useLoaderData();
  const [creating, setCreating] = useState(false);

  return (
    <Page
      title="Integrations"
      actions={
        <Button variant="primary" onPress={() => setCreating(true)}>
          New key
        </Button>
      }
    >
      <PageSection title="API keys">
        <ApiKeysTable apiKeys={apiKeys} />
      </PageSection>
      <PageSection title="MCP clients">
        <CopyableCode value={mcpUrl} label="Endpoint" />
        <McpClientsTable mcpClients={mcpClients} />
      </PageSection>
      <NewApiKeyDialog isOpen={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}

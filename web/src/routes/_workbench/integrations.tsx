import { Segment } from "@heroui-pro/react/segment";
import { Button } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ApiKeysTable } from "../../components/integrations/ApiKeysTable";
import { CopyableCode } from "../../components/integrations/CopyableCode";
import { McpClientsTable } from "../../components/integrations/McpClientsTable";
import { NewApiKeyDialog } from "../../components/integrations/NewApiKeyDialog";
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
  const [creating, setCreating] = useState(false);
  const [section, setSection] = useState("keys");

  return (
    <Page
      title="Integrations"
      actions={
        section === "keys" ? (
          <Button variant="primary" onPress={() => setCreating(true)}>
            New key
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <Segment
          className="self-start"
          selectedKey={section}
          onSelectionChange={(key) => {
            if (key != null) setSection(String(key));
          }}
        >
          <Segment.Item id="keys">API keys</Segment.Item>
          <Segment.Item id="mcp">MCP clients</Segment.Item>
        </Segment>
        {section === "keys" ? (
          <ApiKeysTable apiKeys={apiKeys} />
        ) : (
          <>
            <CopyableCode value={mcpUrl} label="Endpoint" />
            <McpClientsTable mcpClients={mcpClients} />
          </>
        )}
      </div>
      <NewApiKeyDialog isOpen={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}

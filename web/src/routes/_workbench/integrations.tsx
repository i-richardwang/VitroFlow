import { Button } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ApiKeysTable } from "../../features/integrations/ApiKeysTable";
import { CopyableCode } from "../../ui/CopyableCode";
import { InteractiveAnnotationSwitch } from "../../features/integrations/InteractiveAnnotationSwitch";
import { McpClientsTable } from "../../features/integrations/McpClientsTable";
import { NewApiKeyDialog } from "../../features/integrations/NewApiKeyDialog";
import { isAdmin } from "../../domain/auth/schema";
import { Page, PageSection } from "../../ui/Page";
import { getIntegrations } from "../../functions/integrations";
import { m } from "../../paraglide/messages";

export const Route = createFileRoute("/_workbench/integrations")({
  loader: () => getIntegrations(),
  staticData: { crumbs: () => [{ label: m.integrations_title() }] },
  head: () => ({
    meta: [{ title: `${m.integrations_title()} · ${m.app_name()}` }],
  }),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const { apiKeys, mcpClients, mcpUrls, interactiveAnnotation } =
    Route.useLoaderData();
  const { user } = Route.useRouteContext();
  const [creating, setCreating] = useState(false);

  return (
    <Page
      title={m.integrations_title()}
      actions={
        <Button variant="primary" onPress={() => setCreating(true)}>
          {m.integrations_new_key()}
        </Button>
      }
    >
      <PageSection title={m.integrations_api_keys()}>
        <ApiKeysTable apiKeys={apiKeys} />
      </PageSection>
      <PageSection title={m.integrations_mcp_servers()}>
        <CopyableCode
          value={mcpUrls.experiments}
          label={m.mcp_server_experiments()}
          description={m.mcp_server_experiments_description()}
        />
        <CopyableCode
          value={mcpUrls.annotation}
          label={m.mcp_server_annotation()}
          description={
            interactiveAnnotation
              ? m.mcp_server_annotation_description()
              : m.mcp_server_annotation_disabled()
          }
        />
        {isAdmin(user) ? (
          <InteractiveAnnotationSwitch enabled={interactiveAnnotation} />
        ) : null}
      </PageSection>
      <PageSection title={m.integrations_mcp_clients()}>
        <McpClientsTable mcpClients={mcpClients} />
      </PageSection>
      <NewApiKeyDialog isOpen={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}

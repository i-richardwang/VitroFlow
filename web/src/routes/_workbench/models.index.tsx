import { EmptyState } from "@heroui-pro/react/empty-state";
import { Chip, Table, toast } from "@heroui/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { DestructiveActionButton } from "../../ui/DestructiveActionDialog";
import { ModelDialogButton } from "../../features/models/ModelDialog";
import { ModelsIcon } from "../../ui/icons";
import { Page } from "../../ui/Page";
import { className, modelName } from "../../ui/model-names";
import { getModelCatalogue, removeModel } from "../../functions/models";
import { m } from "../../paraglide/messages";

export const Route = createFileRoute("/_workbench/models/")({
  loader: () => getModelCatalogue(),
  staticData: { crumbs: () => [{ label: m.models_title() }] },
  head: () => ({
    meta: [{ title: `${m.models_title()} · ${m.app_name()}` }],
  }),
  component: ModelsPage,
});

function ModelsPage() {
  const entries = Route.useLoaderData();
  const router = useRouter();

  return (
    <Page
      title={m.models_title()}
      description={m.models_subtitle()}
      actions={<ModelDialogButton />}
    >
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={m.models_title()}>
            <Table.Header>
              <Table.Column isRowHeader>{m.models_column_model()}</Table.Column>
              <Table.Column>{m.models_column_classes()}</Table.Column>
              <Table.Column>{m.models_column_versions()}</Table.Column>
              <Table.Column>{m.models_column_records()}</Table.Column>
              <Table.Column className="text-right" aria-label="" />
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Media variant="icon">
                      <ModelsIcon />
                    </EmptyState.Media>
                    <EmptyState.Title>{m.models_empty()}</EmptyState.Title>
                  </EmptyState.Header>
                </EmptyState>
              )}
            >
              {entries.map((entry) => {
                const name = modelName(entry.model);
                const records =
                  entry.observationCount + entry.datasetCount === 0
                    ? m.model_records_none()
                    : m.model_records_summary({
                        observations: entry.observationCount,
                        datasets: entry.datasetCount,
                      });
                return (
                  <Table.Row key={entry.model.id}>
                    <Table.Cell>
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{name}</span>
                        <span className="font-mono text-muted">
                          {entry.model.id}
                        </span>
                      </span>
                    </Table.Cell>
                    <Table.Cell className="text-muted">
                      {entry.model.classes
                        .map((each) => className(each))
                        .join(" · ")}
                    </Table.Cell>
                    <Table.Cell>
                      {entry.versionCount === 0 ? (
                        <Chip variant="soft" size="sm">
                          {m.model_untrained()}
                        </Chip>
                      ) : (
                        <span className="font-mono tabular-nums">
                          {entry.versionCount}
                        </span>
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-muted">{records}</Table.Cell>
                    <Table.Cell className="text-right">
                      <DestructiveActionButton
                        label={m.model_delete()}
                        title={m.model_menu_delete({ name })}
                        confirmLabel={m.model_delete()}
                        onConfirm={async () => {
                          await removeModel({
                            data: { model: entry.model.id },
                          });
                          toast.success(m.model_deleted({ name }));
                          await router.invalidate();
                        }}
                      >
                        {m.model_delete_prompt({ name })}
                      </DestructiveActionButton>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </Page>
  );
}

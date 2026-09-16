import { EmptyState } from "@heroui-pro/react/empty-state";
import { Table } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";

import { ModelDialogButton } from "../../features/models/ModelDialog";
import { ModelMenu } from "../../features/models/ModelMenu";
import { modelRecordsSummary } from "../../features/models/records";
import { ModelsIcon } from "../../ui/icons";
import { Page } from "../../ui/Page";
import { className, modelName } from "../../ui/model-names";
import { getModelCatalogue } from "../../functions/models";
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

  return (
    <Page title={m.models_title()} actions={<ModelDialogButton />}>
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={m.models_title()}>
            <Table.Header>
              <Table.Column isRowHeader>{m.models_column_model()}</Table.Column>
              <Table.Column>{m.model_id_label()}</Table.Column>
              <Table.Column>{m.models_column_classes()}</Table.Column>
              <Table.Column>{m.models_column_records()}</Table.Column>
              <Table.Column
                className="text-right"
                aria-label={m.models_column_actions()}
              />
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
                const held = modelRecordsSummary(entry.records);
                return (
                  <Table.Row key={entry.model.id}>
                    <Table.Cell className="font-medium">
                      {modelName(entry.model)}
                    </Table.Cell>
                    <Table.Cell className="font-mono text-muted">
                      {entry.model.id}
                    </Table.Cell>
                    <Table.Cell className="text-muted">
                      {entry.model.classes
                        .map((each) => className(each))
                        .join(" · ")}
                    </Table.Cell>
                    <Table.Cell className="text-muted">
                      {held ?? m.model_records_none()}
                    </Table.Cell>
                    <Table.Cell className="text-right">
                      <ModelMenu model={entry.model} deletable={!held} />
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

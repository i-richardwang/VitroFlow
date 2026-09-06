import { EmptyState } from "@heroui-pro/react/empty-state";
import { Table } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";

import { Count } from "../../components/Count";
import { ImportDatasetButton } from "../../components/dataset/ImportDatasetDialog";
import { Page } from "../../components/Page";
import { DatasetsIcon } from "../../components/icons";
import { getDatasets } from "../../functions/datasets";
import { m } from "../../paraglide/messages";

export const Route = createFileRoute("/_workbench/datasets/")({
  loader: () => getDatasets(),
  staticData: { crumbs: () => [{ label: m.datasets_title() }] },
  head: () => ({
    meta: [{ title: `${m.datasets_title()} · ${m.app_name()}` }],
  }),
  component: DatasetsPage,
});

function DatasetsPage() {
  const datasets = Route.useLoaderData();

  return (
    <Page title={m.datasets_title()} actions={<ImportDatasetButton />}>
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={m.datasets_title()}>
            <Table.Header>
              <Table.Column isRowHeader>
                {m.datasets_column_dataset()}
              </Table.Column>
              <Table.Column>{m.datasets_column_model()}</Table.Column>
              <Table.Column className="text-right">
                {m.datasets_column_images()}
              </Table.Column>
              <Table.Column className="text-right">
                {m.datasets_column_reviewed()}
              </Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Media variant="icon">
                      <DatasetsIcon />
                    </EmptyState.Media>
                    <EmptyState.Title>{m.datasets_empty()}</EmptyState.Title>
                  </EmptyState.Header>
                </EmptyState>
              )}
            >
              {datasets.map((dataset) => (
                <Table.Row
                  key={dataset.dataset}
                  href={`/datasets/${dataset.dataset}`}
                  className="cursor-(--cursor-interactive)"
                >
                  <Table.Cell className="font-mono font-medium">
                    {dataset.dataset}
                  </Table.Cell>
                  <Table.Cell className="font-mono text-muted">
                    {dataset.modelId}
                  </Table.Cell>
                  <Table.Cell className="text-right font-mono tabular-nums text-muted">
                    {dataset.imageCount}
                  </Table.Cell>
                  <Table.Cell className="text-right font-mono tabular-nums">
                    <Count value={dataset.reviewedCount} />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </Page>
  );
}

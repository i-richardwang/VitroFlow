import { EmptyState } from "@heroui-pro/react/empty-state";
import { Table } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";

import { Count } from "../../components/Count";
import { ImportDatasetButton } from "../../components/dataset/ImportDatasetDialog";
import { Page } from "../../components/Page";
import { DatasetsIcon } from "../../components/icons";
import { getDatasets } from "../../functions/datasets";

export const Route = createFileRoute("/_workbench/datasets/")({
  loader: () => getDatasets(),
  staticData: { crumbs: [{ label: "Datasets" }] },
  component: DatasetsPage,
});

function DatasetsPage() {
  const datasets = Route.useLoaderData();

  return (
    <Page title="Datasets" actions={<ImportDatasetButton />}>
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Datasets">
            <Table.Header>
              <Table.Column isRowHeader>Dataset</Table.Column>
              <Table.Column>Model</Table.Column>
              <Table.Column className="text-right">Images</Table.Column>
              <Table.Column className="whitespace-nowrap text-right">
                To review
              </Table.Column>
              <Table.Column className="text-right">Complete</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Media variant="icon">
                      <DatasetsIcon />
                    </EmptyState.Media>
                    <EmptyState.Title>No datasets yet</EmptyState.Title>
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
                    <Count
                      value={
                        dataset.counts.unreviewed + dataset.counts.in_progress
                      }
                    />
                  </Table.Cell>
                  <Table.Cell className="text-right font-mono tabular-nums">
                    <Count value={dataset.counts.complete} />
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

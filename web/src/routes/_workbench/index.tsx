import { EmptyState } from "@heroui-pro/react/empty-state";
import { Table } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";

import { Count } from "../../components/Count";
import { Page } from "../../components/Page";
import { DatasetsIcon } from "../../components/icons";
import { UploadCard } from "../../components/UploadCard";
import { getDatasets } from "../../server/images";

export const Route = createFileRoute("/_workbench/")({
  loader: () => getDatasets(),
  component: DatasetsPage,
});

function DatasetsPage() {
  const datasets = Route.useLoaderData();

  return (
    <Page title="Datasets">
      <UploadCard />

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Datasets">
            <Table.Header>
              <Table.Column isRowHeader>Dataset</Table.Column>
              <Table.Column className="text-right">Images</Table.Column>
              <Table.Column className="text-right">Pending</Table.Column>
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
                  <Table.Cell className="text-right font-mono tabular-nums text-muted">
                    {dataset.imageCount}
                  </Table.Cell>
                  <Table.Cell className="text-right font-mono tabular-nums">
                    <Count
                      value={dataset.counts.pending + dataset.counts.failed}
                    />
                  </Table.Cell>
                  <Table.Cell className="text-right font-mono tabular-nums">
                    <Count
                      value={
                        dataset.counts.prelabeled + dataset.counts.in_progress
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

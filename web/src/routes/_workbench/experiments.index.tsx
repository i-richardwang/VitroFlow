import { EmptyState } from "@heroui-pro/react/empty-state";
import { Table } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";

import { Count } from "../../components/Count";
import { NewExperimentDialog } from "../../components/experiment/NewExperimentDialog";
import { ExperimentsIcon } from "../../components/icons";
import { Page } from "../../components/Page";
import { Timestamp } from "../../components/Timestamp";
import { versionSlug } from "../../models/schema";
import {
  getExperiments,
  getExperimentVersions,
} from "../../functions/experiments";

export const Route = createFileRoute("/_workbench/experiments/")({
  loader: async () => {
    const [experiments, versions] = await Promise.all([
      getExperiments(),
      getExperimentVersions(),
    ]);
    return { experiments, versions };
  },
  staticData: { crumbs: [{ label: "Experiments" }] },
  component: ExperimentsPage,
});

function ExperimentsPage() {
  const { experiments, versions } = Route.useLoaderData();

  return (
    <Page
      title="Experiments"
      actions={<NewExperimentDialog versions={versions} />}
    >
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Experiments">
            <Table.Header>
              <Table.Column isRowHeader>Experiment</Table.Column>
              <Table.Column>Material</Table.Column>
              <Table.Column>Created</Table.Column>
              <Table.Column>Version</Table.Column>
              <Table.Column className="text-right">Dishes</Table.Column>
              <Table.Column className="text-right">Rounds</Table.Column>
              <Table.Column className="text-right">Pending</Table.Column>
              <Table.Column className="text-right">Failed</Table.Column>
              <Table.Column className="text-right">Observed</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Media variant="icon">
                      <ExperimentsIcon />
                    </EmptyState.Media>
                    <EmptyState.Title>No experiments yet</EmptyState.Title>
                  </EmptyState.Header>
                </EmptyState>
              )}
            >
              {experiments.map(
                ({ experiment, version, dishes, rounds, counts }) => (
                  <Table.Row
                    key={experiment.id}
                    href={`/experiments/${experiment.id}`}
                    className="cursor-(--cursor-interactive)"
                  >
                    <Table.Cell className="font-medium">
                      {experiment.name}
                    </Table.Cell>
                    <Table.Cell className="truncate text-muted">
                      {experiment.material || "—"}
                    </Table.Cell>
                    <Table.Cell className="text-muted">
                      <Timestamp value={experiment.createdAt} />
                    </Table.Cell>
                    <Table.Cell className="truncate font-mono text-muted">
                      {versionSlug(version)}
                    </Table.Cell>
                    <Table.Cell className="text-right font-mono tabular-nums text-muted">
                      {dishes}
                    </Table.Cell>
                    <Table.Cell className="text-right font-mono tabular-nums text-muted">
                      {rounds}
                    </Table.Cell>
                    <Table.Cell className="text-right font-mono tabular-nums">
                      <Count value={counts.pending} />
                    </Table.Cell>
                    <Table.Cell className="text-right font-mono tabular-nums">
                      <Count value={counts.failed} />
                    </Table.Cell>
                    <Table.Cell className="text-right font-mono tabular-nums">
                      <Count value={counts.observed} />
                    </Table.Cell>
                  </Table.Row>
                ),
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </Page>
  );
}

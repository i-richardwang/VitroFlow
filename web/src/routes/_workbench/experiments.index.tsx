import { EmptyState } from "@heroui-pro/react/empty-state";
import { Table } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";

import {
  ImageAnalysisStateChip,
  summarizedImageAnalysis,
} from "../../components/experiment/ImageAnalysisStateChip";
import { NewExperimentDialog } from "../../components/experiment/NewExperimentDialog";
import { ExperimentsIcon } from "../../components/icons";
import { Page } from "../../components/Page";
import {
  getExperiments,
  getExperimentVersions,
} from "../../functions/experiments";
import { versionSlug } from "../../models/schema";

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
              <Table.Column>Inoculated</Table.Column>
              <Table.Column>Version</Table.Column>
              <Table.Column className="text-right">Observations</Table.Column>
              <Table.Column>State</Table.Column>
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
                ({ experiment, version, observations, counts }) => {
                  const state = summarizedImageAnalysis(counts);
                  return (
                    <Table.Row
                      key={experiment.id}
                      href={`/experiments/${experiment.id}`}
                      className="cursor-(--cursor-interactive)"
                    >
                      <Table.Cell className="font-medium">
                        {experiment.name}
                      </Table.Cell>
                      <Table.Cell className="truncate text-muted">
                        {experiment.plantMaterial || "—"}
                      </Table.Cell>
                      <Table.Cell className="text-muted">
                        {experiment.inoculatedOn}
                      </Table.Cell>
                      <Table.Cell className="truncate font-mono text-muted">
                        {versionSlug(version)}
                      </Table.Cell>
                      <Table.Cell className="text-right font-mono tabular-nums text-muted">
                        {observations}
                      </Table.Cell>
                      <Table.Cell>
                        {state ? (
                          <ImageAnalysisStateChip state={state} />
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  );
                },
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </Page>
  );
}

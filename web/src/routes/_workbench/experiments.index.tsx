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
import { getExperiments } from "../../functions/experiments";
import { m } from "../../paraglide/messages";

export const Route = createFileRoute("/_workbench/experiments/")({
  loader: () => getExperiments(),
  staticData: { crumbs: () => [{ label: m.experiments_title() }] },
  head: () => ({
    meta: [{ title: `${m.experiments_title()} · ${m.app_name()}` }],
  }),
  component: ExperimentsPage,
});

function ExperimentsPage() {
  const experiments = Route.useLoaderData();

  return (
    <Page title={m.experiments_title()} actions={<NewExperimentDialog />}>
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={m.experiments_title()}>
            <Table.Header>
              <Table.Column isRowHeader>
                {m.experiments_column_experiment()}
              </Table.Column>
              <Table.Column>{m.experiments_column_material()}</Table.Column>
              <Table.Column>{m.experiments_column_treatments()}</Table.Column>
              <Table.Column>{m.experiments_column_inoculated()}</Table.Column>
              <Table.Column>{m.experiments_column_latest()}</Table.Column>
              <Table.Column>{m.experiments_column_analysis()}</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Media variant="icon">
                      <ExperimentsIcon />
                    </EmptyState.Media>
                    <EmptyState.Title>{m.experiments_empty()}</EmptyState.Title>
                  </EmptyState.Header>
                </EmptyState>
              )}
            >
              {experiments.map(
                ({ experiment, treatmentNames, latestDay, counts }) => {
                  const state = summarizedImageAnalysis(counts);
                  const material = [
                    experiment.plantMaterial,
                    experiment.explantType,
                  ]
                    .filter(Boolean)
                    .join(" · ");
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
                        {material || "—"}
                      </Table.Cell>
                      <Table.Cell className="truncate text-muted">
                        {treatmentNames.length > 0
                          ? treatmentNames.join(" · ")
                          : "—"}
                      </Table.Cell>
                      <Table.Cell className="text-muted">
                        {experiment.inoculatedOn}
                      </Table.Cell>
                      <Table.Cell className="text-muted">
                        {latestDay === null
                          ? "—"
                          : m.observation_day_label({ day: latestDay })}
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

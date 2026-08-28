import { EmptyState, Table } from "@heroui/react";

import { versionSlug } from "../../models/schema";
import type { TrainingRunSummary } from "../../server/training-runs";
import { trainingRunLabel } from "../../training/schema";
import { Timestamp } from "../Timestamp";
import { Metric } from "./Metric";
import { TrainingRunState } from "./TrainingRunState";

export function TrainingRunsTable({
  runs,
  datasetColumn = false,
  emptyHint,
}: {
  runs: TrainingRunSummary[];
  /** Shown when the rows come from several datasets. */
  datasetColumn?: boolean;
  emptyHint: string;
}) {
  if (runs.length === 0) {
    return (
      <EmptyState className="flex min-h-32 flex-col items-center justify-center gap-1 text-center">
        <span className="font-medium">No training runs yet</span>
        <span className="text-xs text-muted">{emptyHint}</span>
      </EmptyState>
    );
  }

  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="Training runs">
          <Table.Header>
            <Table.Column isRowHeader>Run</Table.Column>
            {datasetColumn && <Table.Column>Dataset</Table.Column>}
            <Table.Column>State</Table.Column>
            <Table.Column className="text-right">Epochs</Table.Column>
            <Table.Column className="whitespace-nowrap text-right">
              Best mAP50
            </Table.Column>
            <Table.Column className="whitespace-nowrap text-right">
              mAP50-95
            </Table.Column>
            <Table.Column>Version</Table.Column>
          </Table.Header>
          <Table.Body>
            {runs.map(({ dataset, run, completed, best }) => (
              <Table.Row
                key={run.id}
                href={`/datasets/${dataset}/training/${run.id}`}
                className="cursor-(--cursor-interactive)"
              >
                <Table.Cell className="font-mono font-medium">
                  {trainingRunLabel(run)}
                  <span className="mt-1 block font-sans text-xs font-normal text-muted">
                    <Timestamp value={run.createdAt} />
                  </span>
                </Table.Cell>
                {datasetColumn && (
                  <Table.Cell className="font-mono">{dataset}</Table.Cell>
                )}
                <Table.Cell>
                  <TrainingRunState run={run} />
                </Table.Cell>
                <Table.Cell className="whitespace-nowrap text-right font-mono tabular-nums">
                  {completed}
                  <span className="text-muted">
                    {" "}
                    / {run.recipe.parameters.epochs}
                  </span>
                </Table.Cell>
                <Table.Cell className="text-right font-mono tabular-nums">
                  <Metric value={best?.map50 ?? null} />
                </Table.Cell>
                <Table.Cell className="text-right font-mono tabular-nums">
                  <Metric value={best?.map5095 ?? null} />
                </Table.Cell>
                <Table.Cell className="font-mono text-xs text-muted">
                  {run.state.status === "succeeded"
                    ? versionSlug({
                        id: run.state.modelVersionId,
                        modelId: run.modelId,
                      })
                    : "—"}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

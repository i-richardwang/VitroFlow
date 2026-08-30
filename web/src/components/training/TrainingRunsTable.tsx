import { EmptyState } from "@heroui-pro/react/empty-state";
import { Link, Table } from "@heroui/react";

import { versionSlug } from "../../models/schema";
import type { TrainingRunSummary } from "../../server/training-runs";
import { trainingRunLabel } from "../../training/schema";
import { EmptyStateHeading } from "../EmptyStateHeading";
import { Hint } from "../Hint";
import { TrainingIcon } from "../icons";
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
  emptyHint?: string;
}) {
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
          <Table.Body
            renderEmptyState={() => (
              <EmptyState size="sm">
                <EmptyState.Header>
                  <EmptyState.Media variant="icon">
                    <TrainingIcon />
                  </EmptyState.Media>
                  <EmptyStateHeading>No training runs yet</EmptyStateHeading>
                  {emptyHint ? (
                    <EmptyState.Description>{emptyHint}</EmptyState.Description>
                  ) : null}
                </EmptyState.Header>
                {datasetColumn ? (
                  <EmptyState.Content>
                    <Link href="/datasets" className="text-sm font-medium">
                      Open datasets
                    </Link>
                  </EmptyState.Content>
                ) : null}
              </EmptyState>
            )}
          >
            {runs.map(({ dataset, run, completed, best }) => (
              <Table.Row
                key={run.id}
                href={`/datasets/${dataset}/training/${run.id}`}
                className="cursor-(--cursor-interactive)"
              >
                <Table.Cell className="font-mono font-medium">
                  {trainingRunLabel(run)}
                </Table.Cell>
                {datasetColumn && (
                  <Table.Cell className="font-mono">{dataset}</Table.Cell>
                )}
                <Table.Cell>
                  <Hint
                    text={
                      run.state.status === "failed" ? run.state.error : null
                    }
                  >
                    <TrainingRunState run={run} />
                  </Hint>
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
                  <Metric value={best?.map50To95 ?? null} />
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

import { EmptyState, Table } from "@heroui/react";

import { versionSlug } from "../../models/schema";
import type { TrainingRunSummary } from "../../server/training-console";
import { MIN_SNAPSHOT_IMAGES, trainingRunLabel } from "../../training/schema";
import { Timestamp } from "../Timestamp";
import { Metric } from "./Metric";
import { TrainingRunState } from "./TrainingRunState";

export function TrainingRunsTable({
  dataset,
  runs,
  complete,
}: {
  dataset: string;
  runs: TrainingRunSummary[];
  complete: number;
}) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="Training runs">
          <Table.Header>
            <Table.Column isRowHeader>Run</Table.Column>
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
              <EmptyState className="flex min-h-32 flex-col items-center justify-center gap-1 text-center">
                <span className="font-medium">No training runs yet</span>
                <span className="text-xs text-muted">
                  {complete < MIN_SNAPSHOT_IMAGES
                    ? `Complete at least ${MIN_SNAPSHOT_IMAGES} annotations to train.`
                    : "Train a YOLO version from the reviewed annotations."}
                </span>
              </EmptyState>
            )}
          >
            {runs.map(({ run, completed, best }) => (
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

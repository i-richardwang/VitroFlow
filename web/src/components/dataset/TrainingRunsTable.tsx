import { EmptyState, Table } from "@heroui/react";

import {
  MIN_SNAPSHOT_IMAGES,
  trainingRunLabel,
  type TrainingRun,
} from "../../training/schema";
import { Timestamp } from "../Timestamp";
import { TrainingRunState } from "./TrainingRunState";

export function TrainingRunsTable({
  runs,
  complete,
}: {
  runs: TrainingRun[];
  complete: number;
}) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="Training runs">
          <Table.Header>
            <Table.Column isRowHeader>Run</Table.Column>
            <Table.Column>State</Table.Column>
            <Table.Column>Worker</Table.Column>
            <Table.Column className="text-right">Attempt</Table.Column>
            <Table.Column>Recipe</Table.Column>
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
            {runs.map((run) => (
              <Table.Row key={run.id}>
                <Table.Cell className="font-mono font-medium">
                  {trainingRunLabel(run)}
                  <span className="mt-1 block font-sans text-xs font-normal text-muted">
                    <Timestamp value={run.createdAt} />
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <TrainingRunState run={run} />
                </Table.Cell>
                <Table.Cell className="font-mono text-muted">
                  {"workerId" in run.state ? run.state.workerId : "—"}
                </Table.Cell>
                <Table.Cell className="text-right font-mono tabular-nums">
                  {run.attempt}
                </Table.Cell>
                <Table.Cell className="font-mono text-xs text-muted">
                  {run.recipe.baseModel.reference} ·{" "}
                  {run.recipe.configuration.name}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

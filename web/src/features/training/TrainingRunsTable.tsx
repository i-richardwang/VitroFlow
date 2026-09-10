import { EmptyState } from "@heroui-pro/react/empty-state";
import { Link, Table } from "@heroui/react";

import { versionSlug } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import type { TrainingRunSummary } from "../../domain/training/read-model";
import { trainingRunLabel } from "../../domain/training/schema";
import { Hint } from "../../ui/Hint";
import { TrainingIcon } from "../../ui/icons";
import { Metric } from "./Metric";
import { TrainingRunState } from "./TrainingRunState";

export function TrainingRunsTable({
  runs,
  datasetColumn = false,
}: {
  runs: TrainingRunSummary[];
  datasetColumn?: boolean;
}) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={m.run_table_label()}>
          <Table.Header>
            <Table.Column isRowHeader>{m.run_column_run()}</Table.Column>
            {datasetColumn && (
              <Table.Column>{m.run_column_dataset()}</Table.Column>
            )}
            <Table.Column>{m.run_column_state()}</Table.Column>
            <Table.Column className="text-right">
              {m.run_column_epochs()}
            </Table.Column>
            <Table.Column className="whitespace-nowrap text-right">
              {m.run_column_best_map50()}
            </Table.Column>
            <Table.Column className="whitespace-nowrap text-right">
              {m.run_column_map50_95()}
            </Table.Column>
            <Table.Column>{m.run_column_version()}</Table.Column>
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <EmptyState size="sm">
                <EmptyState.Header>
                  <EmptyState.Media variant="icon">
                    <TrainingIcon />
                  </EmptyState.Media>
                  <EmptyState.Title>{m.run_empty_title()}</EmptyState.Title>
                </EmptyState.Header>
                {datasetColumn ? (
                  <EmptyState.Content>
                    <Link href="/datasets" className="text-sm font-medium">
                      {m.run_empty_open_datasets()}
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
                <Table.Cell className="text-right font-mono tabular-nums">
                  {completed}
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

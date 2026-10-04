import { Link } from "@tanstack/react-router";
import { ChartLine } from "lucide-react";
import type { ReactNode } from "react";

import { m } from "../../paraglide/messages";
import type { TrainingRunSummary } from "../../domain/training/read-model";
import { trainingRunLabel } from "../../domain/training/schema";
import { Empty } from "../../ui/kit/Empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { TextLink } from "../../ui/kit/TextLink";
import { Progress } from "../../ui/kit/Progress";
import { Tooltip } from "../../ui/kit/Tooltip";
import { Absent } from "../../ui/Absent";
import { Metric } from "../../ui/Metric";
import { TrainingRunState } from "./TrainingRunState";

/**
 * Training runs, each named with its state after it; across datasets
 * (`datasetColumn`) each run names its dataset. `emptyAction` leads to a
 * first run.
 */
export function TrainingRunsTable({
  runs,
  datasetColumn = false,
  emptyAction,
}: {
  runs: TrainingRunSummary[];
  datasetColumn?: boolean;
  emptyAction: ReactNode;
}) {
  return (
    <Table
      aria-label={m.run_table_label()}
      size="small"
      narrow="cards"
      empty={
        runs.length === 0 && (
          <Empty
            icon={ChartLine}
            title={m.run_empty_title()}
            description={
              datasetColumn
                ? m.run_empty_overview_description()
                : m.run_empty_dataset_description()
            }
            action={emptyAction}
          />
        )
      }
    >
      <TableHeader>
        <tr>
          <TableHead>{m.run_column_run()}</TableHead>
          {datasetColumn && <TableHead>{m.run_column_dataset()}</TableHead>}
          <TableHead className="w-32" numeric>
            {m.run_column_epochs()}
          </TableHead>
          <TableHead className="w-28" numeric>
            {m.run_column_best_map50()}
          </TableHead>
          <TableHead className="w-28" numeric>
            {m.run_column_map50_95()}
          </TableHead>
          <TableHead className="w-48">{m.run_column_version()}</TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {runs.map(({ dataset, run, completed, best }) => (
          <TableRow key={run.id} clickable>
            <TableCell cellSlot="title">
              <span className="flex items-center gap-2">
                <TextLink
                  render={
                    <Link
                      to="/datasets/$dataset/training/$runId"
                      params={{ dataset, runId: run.id }}
                    />
                  }
                >
                  {trainingRunLabel(run)}
                </TextLink>
                <Tooltip
                  title={run.state.status === "failed" ? run.state.error : null}
                >
                  <TrainingRunState run={run} />
                </Tooltip>
              </span>
            </TableCell>
            {datasetColumn && (
              <TableCell
                cellLabel={m.run_column_dataset()}
                className="text-fg-secondary"
              >
                {dataset}
              </TableCell>
            )}
            <TableCell cellLabel={m.run_column_epochs()} numeric>
              <EpochProgress
                completed={completed}
                total={run.recipe.parameters.epochs}
              />
            </TableCell>
            <TableCell cellLabel={m.run_column_best_map50()} numeric>
              <Metric value={best?.map50 ?? null} />
            </TableCell>
            <TableCell cellLabel={m.run_column_map50_95()} numeric>
              <Metric value={best?.map50To95 ?? null} />
            </TableCell>
            <TableCell
              cellLabel={m.run_column_version()}
              className="text-xs text-fg-tertiary tabular-nums"
            >
              {run.state.status === "succeeded" ? (
                run.state.modelVersionId
              ) : (
                <Absent />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Completed epochs over the planned number, with a thin bar under them. */
function EpochProgress({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  return (
    <span className="inline-flex w-24 flex-col items-stretch gap-1">
      {m.run_epochs_progress({ completed, total })}
      <Progress
        aria-label={m.run_column_epochs()}
        size="small"
        value={completed}
        max={total}
      />
    </span>
  );
}

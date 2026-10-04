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
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { TextLink } from "../../ui/kit/TextLink";
import { Tooltip } from "../../ui/kit/Tooltip";
import { Absent } from "../../ui/Absent";
import { Metric } from "../../ui/Metric";
import { TrainingRunState } from "./TrainingRunState";

/**
 * Training runs; across datasets (`datasetColumn`) each run names its dataset.
 * `emptyAction` leads to a first run.
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
    <Table aria-label={m.run_table_label()} narrow="cards">
      <TableHeader>
        <tr>
          <TableHead>{m.run_column_run()}</TableHead>
          {datasetColumn && <TableHead>{m.run_column_dataset()}</TableHead>}
          <TableHead>{m.run_column_state()}</TableHead>
          <TableHead className="w-24 text-end">
            {m.run_column_epochs()}
          </TableHead>
          <TableHead className="w-28 text-end">
            {m.run_column_best_map50()}
          </TableHead>
          <TableHead className="w-28 text-end">
            {m.run_column_map50_95()}
          </TableHead>
          <TableHead className="w-48">{m.run_column_version()}</TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {runs.length ? (
          runs.map(({ dataset, run, completed, best }) => (
            <TableRow key={run.id} clickable>
              <TableCell cellSlot="title">
                <TextLink
                  className="font-mono"
                  render={
                    <Link
                      to="/datasets/$dataset/training/$runId"
                      params={{ dataset, runId: run.id }}
                    />
                  }
                >
                  {trainingRunLabel(run)}
                </TextLink>
              </TableCell>
              {datasetColumn && (
                <TableCell
                  cellLabel={m.run_column_dataset()}
                  className="font-mono text-fg-secondary"
                >
                  {dataset}
                </TableCell>
              )}
              <TableCell cellLabel={m.run_column_state()}>
                <Tooltip
                  title={run.state.status === "failed" ? run.state.error : null}
                >
                  <TrainingRunState run={run} />
                </Tooltip>
              </TableCell>
              <TableCell
                cellLabel={m.run_column_epochs()}
                className="text-end tabular-nums"
              >
                {m.run_epochs_progress({
                  completed,
                  total: run.recipe.parameters.epochs,
                })}
              </TableCell>
              <TableCell
                cellLabel={m.run_column_best_map50()}
                className="text-end font-mono tabular-nums"
              >
                <Metric value={best?.map50 ?? null} />
              </TableCell>
              <TableCell
                cellLabel={m.run_column_map50_95()}
                className="text-end font-mono tabular-nums"
              >
                <Metric value={best?.map50To95 ?? null} />
              </TableCell>
              <TableCell
                cellLabel={m.run_column_version()}
                className="font-mono text-xs text-fg-tertiary"
              >
                {run.state.status === "succeeded" ? (
                  run.state.modelVersionId
                ) : (
                  <Absent />
                )}
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableEmpty>
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
          </TableEmpty>
        )}
      </TableBody>
    </Table>
  );
}

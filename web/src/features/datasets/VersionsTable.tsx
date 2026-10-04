import { Network } from "lucide-react";
import type { ReactNode } from "react";

import { validationMetric } from "../../domain/models/schema";
import type { VersionOverview } from "../../domain/training/read-model";
import { m } from "../../paraglide/messages";
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
import { Timestamp } from "../../ui/Timestamp";
import { Absent } from "../../ui/Absent";
import { Metric } from "../../ui/Metric";
import { ModelKindTag } from "./ModelKindTag";

/** Published versions; `emptyAction` leads to where a first one is trained. */
export function VersionsTable({
  versions,
  emptyAction,
}: {
  versions: VersionOverview[];
  emptyAction: ReactNode;
}) {
  return (
    <Table aria-label={m.versions_table()} narrow="cards">
      <TableHeader>
        <tr>
          <TableHead>{m.versions_column_version()}</TableHead>
          <TableHead>{m.versions_column_model()}</TableHead>
          <TableHead>{m.versions_column_kind()}</TableHead>
          <TableHead>{m.versions_column_published()}</TableHead>
          <TableHead className="w-28" numeric>
            {m.versions_column_trained_on()}
          </TableHead>
          <TableHead className="w-28" numeric>
            {m.epoch_series_map50()}
          </TableHead>
          <TableHead className="w-28" numeric>
            {m.epoch_series_map50_95()}
          </TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {versions.length ? (
          versions.map(({ version, trainingImages }) => (
            <TableRow key={version.id}>
              <TableCell cellSlot="title" className="font-mono">
                {version.id}
              </TableCell>
              <TableCell
                cellLabel={m.versions_column_model()}
                className="font-mono text-fg-secondary"
              >
                {version.modelId}
              </TableCell>
              <TableCell cellLabel={m.versions_column_kind()}>
                <ModelKindTag kind={version.artifact.kind} />
              </TableCell>
              <TableCell
                cellLabel={m.versions_column_published()}
                className="whitespace-nowrap text-fg-tertiary"
              >
                <Timestamp value={version.createdAt} />
              </TableCell>
              <TableCell cellLabel={m.versions_column_trained_on()} numeric>
                {trainingImages === null ? (
                  <Absent />
                ) : (
                  m.versions_trained_images({ count: trainingImages })
                )}
              </TableCell>
              <TableCell
                cellLabel={m.epoch_series_map50()}
                className="font-mono"
                numeric
              >
                <Metric value={validationMetric(version.artifact, "map50")} />
              </TableCell>
              <TableCell
                cellLabel={m.epoch_series_map50_95()}
                className="font-mono"
                numeric
              >
                <Metric
                  value={validationMetric(version.artifact, "map50To95")}
                />
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableEmpty>
            <Empty
              icon={Network}
              title={m.versions_empty()}
              description={m.versions_empty_description()}
              action={emptyAction}
            />
          </TableEmpty>
        )}
      </TableBody>
    </Table>
  );
}

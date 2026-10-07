import type { ReactNode } from "react";

import { validationMetric } from "../../domain/models/schema";
import type { VersionOverview } from "../../domain/training/read-model";
import { m } from "../../paraglide/messages";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { Timestamp } from "../../ui/Timestamp";
import { Absent } from "../../ui/Absent";
import { Metric } from "../../ui/Metric";
import { ModelKindTag } from "./ModelKindTag";

/**
 * A model's published versions, with how many images trained each and how
 * well it scored; `empty` stands in for none.
 */
export function VersionsTable({
  versions,
  empty,
}: {
  versions: VersionOverview[];
  empty: ReactNode;
}) {
  return (
    <Table
      aria-label={m.model_versions()}
      narrow="cards"
      empty={versions.length === 0 && empty}
    >
      <TableHeader>
        <tr>
          <TableHead>{m.versions_column_version()}</TableHead>
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
        {versions.map(({ version, trainingImages }) => (
          <TableRow key={version.id}>
            <TableCell cellSlot="title">{version.id}</TableCell>
            <TableCell cellLabel={m.versions_column_kind()}>
              <ModelKindTag kind={version.artifact.kind} />
            </TableCell>
            <TableCell
              cellLabel={m.versions_column_published()}
              className="whitespace-nowrap"
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
            <TableCell cellLabel={m.epoch_series_map50()} numeric>
              <Metric value={validationMetric(version.artifact, "map50")} />
            </TableCell>
            <TableCell cellLabel={m.epoch_series_map50_95()} numeric>
              <Metric value={validationMetric(version.artifact, "map50To95")} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { VersionComparison } from "../../domain/models/comparison";
import { validationMetric } from "../../domain/models/schema";
import type { VersionOverview } from "../../domain/training/read-model";
import { m } from "../../paraglide/messages";
import { Flexbox } from "../../ui/kit/Flex";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { Tag } from "../../ui/kit/Tag";
import { TextLink } from "../../ui/kit/TextLink";
import { Timestamp } from "../../ui/Timestamp";
import { Absent } from "../../ui/Absent";
import { Metric } from "../../ui/Metric";
import { formatCount } from "../../ui/numbers";
import { ModelKindTag } from "./ModelKindTag";
import { formatError, totalError } from "./comparison";

/**
 * A model's published versions: which one reads, how many images trained
 * each and how well it scored, and how each candidate counts beside the
 * current version. `empty` stands in for none.
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
          <TableHead>{m.versions_column_comparison()}</TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {versions.map(({ version, trainingImages, current, comparison }) => (
          <TableRow key={version.id}>
            <TableCell cellSlot="title">
              <Flexbox horizontal align="center" gap={8}>
                {version.id}
                {current ? (
                  <Tag size="small" color="info">
                    {m.versions_current()}
                  </Tag>
                ) : null}
              </Flexbox>
            </TableCell>
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
            <TableCell
              cellLabel={m.versions_column_comparison()}
              className="whitespace-nowrap"
            >
              {current ? null : (
                <TextLink
                  render={
                    <Link
                      to="/models/$model"
                      params={{ model: version.modelId }}
                      search={{ compare: version.id }}
                      resetScroll={false}
                    />
                  }
                >
                  <ComparisonSummary comparison={comparison} />
                </TextLink>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * What opens the comparison: the candidate's count error beside the current
 * version's over the images both have read, how far reading has come, or,
 * for a version with nothing held out, the choice alone.
 */
function ComparisonSummary({
  comparison,
}: {
  comparison: VersionComparison | null;
}) {
  if (!comparison) return m.versions_choose();
  const { accuracy } = comparison;
  if (!accuracy) {
    return m.versions_comparison_reading({
      read: formatCount(comparison.candidate.read),
      total: formatCount(comparison.heldOut),
    });
  }
  const candidate = formatError(totalError(accuracy.candidate));
  const count = formatCount(comparison.scored);
  return accuracy.current
    ? m.versions_comparison_error({
        current: formatError(totalError(accuracy.current)),
        candidate,
        count,
      })
    : m.versions_comparison_error_alone({ candidate, count });
}

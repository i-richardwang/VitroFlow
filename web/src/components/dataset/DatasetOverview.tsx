import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";

import { versionSlug } from "../../models/schema";
import type { DatasetOverview as Overview } from "../../server/overview";
import { ServingChip } from "./ServingChip";

/** Review progress and the version currently prelabelling this dataset. */
export function DatasetOverview({ overview }: { overview: Overview }) {
  const { counts, versions, inference } = overview;
  const selected = versions.find((entry) => entry.selected);
  const toReview = counts.prelabeled + counts.in_progress;

  return (
    <KPIGroup>
      <KPI>
        <KPI.Header>
          <KPI.Title>Reviewed</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value maximumFractionDigits={0} value={counts.complete} />
        </KPI.Content>
        {toReview > 0 ? (
          <KPI.Footer>
            {toReview} {toReview === 1 ? "image" : "images"} to review
          </KPI.Footer>
        ) : null}
      </KPI>
      <KPIGroup.Separator />
      <KPI>
        <KPI.Header>
          <KPI.Title>Prelabel</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          {selected ? (
            <span className="text-2xl font-semibold tracking-tight">
              {versionSlug(selected.version)}
            </span>
          ) : (
            <span className="text-2xl font-semibold text-muted">None</span>
          )}
        </KPI.Content>
        {selected ? (
          <KPI.Footer>
            <ServingChip serving={inference} />
          </KPI.Footer>
        ) : null}
      </KPI>
    </KPIGroup>
  );
}

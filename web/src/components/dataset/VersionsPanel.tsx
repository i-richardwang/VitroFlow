import { Widget } from "@heroui-pro/react/widget";
import { Link } from "@heroui/react";

import type { DatasetOverview } from "../../server/overview";
import { VersionsTable } from "./VersionsTable";

/** Candidate versions of the dataset's model and which one prelabels it. */
export function VersionsPanel({ overview }: { overview: DatasetOverview }) {
  const { dataset, versions } = overview;

  return (
    <Widget>
      <Widget.Header className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Widget.Title>Model versions</Widget.Title>
          <Widget.Description>
            Every version is a candidate; prelabelling only follows the selected
            one, and a new version never replaces it on its own.
          </Widget.Description>
        </div>
        <Link
          href={`/datasets/${dataset.id}/training`}
          className="shrink-0 text-sm font-medium"
        >
          Training
        </Link>
      </Widget.Header>
      <Widget.Content>
        <VersionsTable dataset={dataset.id} versions={versions} />
      </Widget.Content>
    </Widget>
  );
}

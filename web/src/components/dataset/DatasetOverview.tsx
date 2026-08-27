import { Card, ProgressBar } from "@heroui/react";

import { versionSlug } from "../../models/schema";
import type { DatasetOverview as Overview } from "../../server/overview";
import { ModelKindChip } from "./ModelKindChip";
import { ServingChip } from "./ServingChip";

/** The dataset's identity, review progress, and the version doing its prelabelling. */
export function DatasetOverview({ overview }: { overview: Overview }) {
  const { counts, images, versions, inference, training } = overview;
  const selected = versions.find((entry) => entry.selected);
  const reviewed = counts.complete + counts.excluded;

  return (
    <Card className="grid gap-6 p-6 sm:grid-cols-3">
      <Fact label="Reviewed">
        <ProgressBar
          aria-label="Reviewed images"
          value={reviewed}
          minValue={0}
          maxValue={Math.max(images.length, 1)}
          color="success"
          size="sm"
        >
          <ProgressBar.Track>
            <ProgressBar.Fill />
          </ProgressBar.Track>
        </ProgressBar>
        <span className="font-mono tabular-nums">
          {counts.complete}
          <span className="text-muted"> / {images.length} complete</span>
        </span>
        <span className="text-xs text-muted">
          {counts.pending + counts.failed} awaiting detection ·{" "}
          {counts.prelabeled + counts.in_progress} to review
        </span>
      </Fact>

      <Fact label="Prelabelled by">
        {selected ? (
          <>
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{versionSlug(selected.version)}</span>
              <ModelKindChip kind={selected.version.artifact.kind} />
            </span>
            <span className="text-xs text-muted">{selected.version.name}</span>
            <ServingChip serving={inference} />
          </>
        ) : (
          <span className="text-muted">No version selected</span>
        )}
      </Fact>

      <Fact label="Training">
        <span className="font-mono tabular-nums">
          {training.reviewedSinceLastRun}
          <span className="text-muted"> reviewed since last run</span>
        </span>
        <span className="text-xs text-muted">
          {training.runs.length} {training.runs.length === 1 ? "run" : "runs"}
          {" · "}
          {training.workersOnline}{" "}
          {training.workersOnline === 1 ? "worker" : "workers"} online
        </span>
      </Fact>
    </Card>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

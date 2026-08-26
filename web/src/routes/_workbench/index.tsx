import { EmptyState, Link, Table } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";

import { Page } from "../../components/Page";
import { listRuns } from "../../server/runs";

export const Route = createFileRoute("/_workbench/")({
  loader: () => listRuns(),
  component: RunsPage,
});

function RunsPage() {
  const runs = Route.useLoaderData();

  return (
    <Page
      title="Runs"
      description="Open a published run to review and correct detections."
    >
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Runs">
            <Table.Header>
              <Table.Column isRowHeader>Run</Table.Column>
              <Table.Column className="text-right">Images</Table.Column>
              <Table.Column className="text-right">Complete</Table.Column>
              <Table.Column className="text-right">Flagged</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
                  <span className="flex flex-col gap-1">
                    <span className="font-medium">No runs yet</span>
                    <span className="text-xs text-muted">
                      Create a recognition job and keep a Worker connected.
                    </span>
                  </span>
                  <Link href="/jobs">Create job</Link>
                </EmptyState>
              )}
            >
              {runs.map((run) => (
                <Table.Row
                  key={run.runId}
                  href={`/runs/${run.runId}`}
                  className="cursor-(--cursor-interactive)"
                >
                  <Table.Cell className="font-mono font-medium">
                    {run.runId}
                  </Table.Cell>
                  <Table.Cell className="text-right font-mono tabular-nums text-muted">
                    {run.imageCount}
                  </Table.Cell>
                  <Table.Cell className="text-right font-mono tabular-nums">
                    {run.completedCount}
                    <span className="text-muted"> / {run.imageCount}</span>
                  </Table.Cell>
                  <Table.Cell className="text-right font-mono tabular-nums">
                    {run.flaggedCount > 0 ? (
                      <span className="text-warning">{run.flaggedCount}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </Page>
  );
}

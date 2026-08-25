import { Card, EmptyState, Table } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";

import { listRuns } from "../server/runs";

export const Route = createFileRoute("/")({
  loader: () => listRuns(),
  component: RunsPage,
});

function RunsPage() {
  const runs = Route.useLoaderData();

  return (
    <main className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Runs</h1>

      {runs.length === 0 ? (
        <Card className="mt-8">
          <Card.Content>
            <EmptyState className="flex flex-col items-center justify-center gap-1 text-center">
              <span className="font-medium">No runs yet</span>
              <span className="text-xs text-muted">
                Generate one from the repository root, then reload this page.
              </span>
              <code className="mt-3 rounded-md bg-surface-secondary px-3 py-2 font-mono text-xs">
                uv run vitroflow data/images/&lt;dataset&gt; --data-root data
                -o data/runs/&lt;run-name&gt;
              </code>
            </EmptyState>
          </Card.Content>
        </Card>
      ) : (
        <Table className="mt-8">
          <Table.ScrollContainer>
            <Table.Content aria-label="Runs">
              <Table.Header>
                <Table.Column isRowHeader>Run</Table.Column>
                <Table.Column className="text-right">Images</Table.Column>
                <Table.Column className="text-right">Complete</Table.Column>
                <Table.Column className="text-right">Flagged</Table.Column>
              </Table.Header>
              <Table.Body>
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
      )}
    </main>
  );
}

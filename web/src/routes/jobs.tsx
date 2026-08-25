import { Button, Card, Chip, EmptyState, Link, Table } from "@heroui/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";

import type { JobStatus } from "../jobs/schema";
import { getJobs } from "../server/jobs";

export const Route = createFileRoute("/jobs")({
  validateSearch: z.object({
    created: z.string().optional(),
    retried: z.string().optional(),
    error: z.string().optional(),
  }),
  loader: () => getJobs(),
  component: JobsPage,
});

const STATUS: Record<
  JobStatus,
  { label: string; color: "default" | "warning" | "success" | "danger" }
> = {
  queued: { label: "Queued", color: "default" },
  running: { label: "Running", color: "warning" },
  publishing: { label: "Publishing", color: "warning" },
  succeeded: { label: "Succeeded", color: "success" },
  failed: { label: "Failed", color: "danger" },
};

function JobsPage() {
  const jobs = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const active = jobs.some(
    (job) =>
      job.status === "queued" ||
      job.status === "running" ||
      job.status === "publishing",
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = window.setInterval(() => void router.invalidate(), 3000);
    return () => window.clearInterval(timer);
  }, [active, router]);

  return (
    <main className="mx-auto max-w-4xl px-8 py-10">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Recognition jobs
        </h1>
        <p className="mt-1 text-sm text-muted">
          Upload images here. A connected Worker will process them and publish
          a run for annotation.
        </p>
      </div>

      {search.error && (
        <div className="mt-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {search.error}
        </div>
      )}
      {(search.created || search.retried) && (
        <div className="mt-6 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          {search.created ? "Job created." : "Job queued again."}
        </div>
      )}

      <Card className="mt-6">
        <form
          method="post"
          action="/api/jobs"
          encType="multipart/form-data"
        >
          <Card.Header>
            <Card.Title>New recognition job</Card.Title>
            <Card.Description>
              Dataset and run identifiers use letters, numbers, dots, dashes,
              and underscores. Upload up to 100 images, 64 MiB each and 512 MiB
              total.
            </Card.Description>
          </Card.Header>
          <Card.Content className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Dataset
              <input
                name="dataset"
                required
                pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,79}"
                placeholder="seed-2026-08"
                className="h-9 rounded-lg border border-separator bg-background px-3 font-mono text-sm outline-none focus:border-accent"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Run ID
              <input
                name="runId"
                required
                pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,79}"
                placeholder="seed-2026-08-baseline"
                className="h-9 rounded-lg border border-separator bg-background px-3 font-mono text-sm outline-none focus:border-accent"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium md:col-span-2">
              Images
              <input
                name="images"
                type="file"
                accept=".jpg,.jpeg,.png,.tif,.tiff"
                multiple
                required
                className="rounded-lg border border-separator bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-surface-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium"
              />
            </label>
          </Card.Content>
          <Card.Footer>
            <Button type="submit" variant="primary" size="sm">
              Create job
            </Button>
          </Card.Footer>
        </form>
      </Card>

      <section className="mt-10">
        <h2 className="text-base font-semibold">Jobs</h2>
        {jobs.length === 0 ? (
          <Card className="mt-4">
            <Card.Content>
              <EmptyState className="flex min-h-32 flex-col items-center justify-center gap-1 text-center">
                <span className="font-medium">No recognition jobs</span>
                <span className="text-xs text-muted">
                  Upload a batch to create the first job.
                </span>
              </EmptyState>
            </Card.Content>
          </Card>
        ) : (
          <Table className="mt-4">
            <Table.ScrollContainer>
              <Table.Content aria-label="Recognition jobs">
                <Table.Header>
                  <Table.Column isRowHeader>Run</Table.Column>
                  <Table.Column>Dataset</Table.Column>
                  <Table.Column>Status</Table.Column>
                  <Table.Column className="text-right">Progress</Table.Column>
                  <Table.Column>Created</Table.Column>
                  <Table.Column>Action</Table.Column>
                </Table.Header>
                <Table.Body>
                  {jobs.map((job) => (
                    <Table.Row key={job.id}>
                      <Table.Cell className="font-mono font-medium">
                        {job.runId}
                        {job.status === "failed" && (
                          <span
                            className="mt-1 block max-w-72 truncate font-sans text-xs font-normal text-danger"
                            title={job.error}
                          >
                            {job.error}
                          </span>
                        )}
                      </Table.Cell>
                      <Table.Cell className="font-mono text-muted">
                        {job.dataset}
                      </Table.Cell>
                      <Table.Cell>
                        <Chip
                          color={STATUS[job.status].color}
                          variant="soft"
                          size="sm"
                        >
                          {STATUS[job.status].label}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell className="text-right font-mono tabular-nums">
                        {job.completedImages}
                        <span className="text-muted"> / {job.images.length}</span>
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap text-muted">
                        {new Date(job.createdAt).toLocaleString()}
                      </Table.Cell>
                      <Table.Cell>
                        {job.status === "failed" ? (
                          <form
                            method="post"
                            action={`/api/jobs/${job.id}/retry`}
                          >
                            <Button
                              type="submit"
                              variant="secondary"
                              size="sm"
                            >
                              Retry
                            </Button>
                          </form>
                        ) : job.status === "succeeded" ? (
                          <Link
                            href={`/runs/${job.runId}`}
                            className="text-xs font-medium"
                          >
                            Open run
                          </Link>
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
      </section>
    </main>
  );
}

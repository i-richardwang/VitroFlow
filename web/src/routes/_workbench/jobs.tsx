import {
  Alert,
  Button,
  Card,
  Chip,
  Description,
  EmptyState,
  FieldError,
  Fieldset,
  Form,
  Input,
  Label,
  Link,
  Table,
  TextField,
} from "@heroui/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";

import { Page } from "../../components/Page";
import type { JobStatus } from "../../jobs/schema";
import { getJobs } from "../../server/jobs";

export const Route = createFileRoute("/_workbench/jobs")({
  validateSearch: z.object({
    created: z.string().optional(),
    retried: z.string().optional(),
    error: z.string().optional(),
  }),
  loader: () => getJobs(),
  component: JobsPage,
});

const IDENTIFIER = "[A-Za-z0-9][A-Za-z0-9._-]{0,79}";

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
    <Page
      title="Jobs"
      description="Upload images here. A connected Worker will process them and publish a run for annotation."
    >
      {search.error && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{search.error}</Alert.Title>
          </Alert.Content>
        </Alert>
      )}
      {(search.created || search.retried) && (
        <Alert status="success">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              {search.created ? "Job created." : "Job queued again."}
            </Alert.Title>
          </Alert.Content>
        </Alert>
      )}

      <CreateJobForm />

      <Table>
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
            <Table.Body
              renderEmptyState={() => (
                <EmptyState className="flex min-h-40 flex-col items-center justify-center gap-1 text-center">
                  <span className="font-medium">No recognition jobs</span>
                  <span className="text-xs text-muted">
                    Upload a batch to create the first job.
                  </span>
                </EmptyState>
              )}
            >
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
                      <Form
                        method="post"
                        action={`/api/jobs/${job.id}/retry`}
                      >
                        <Button type="submit" variant="secondary" size="sm">
                          Retry
                        </Button>
                      </Form>
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
    </Page>
  );
}

function CreateJobForm() {
  return (
    <Card className="p-6">
      <Form
        method="post"
        action="/api/jobs"
        encType="multipart/form-data"
        className="w-full"
      >
        <Fieldset>
          <Fieldset.Legend>New recognition job</Fieldset.Legend>
          <Description>
            Dataset and run identifiers use letters, numbers, dots, dashes, and
            underscores.
          </Description>
          <Fieldset.Group className="grid gap-4 md:grid-cols-2">
            <TextField
              fullWidth
              isRequired
              name="dataset"
              pattern={IDENTIFIER}
              autoFocus
            >
              <Label>Dataset</Label>
              <Input className="font-mono" placeholder="seed-2026-08" />
              <FieldError />
            </TextField>
            <TextField
              fullWidth
              isRequired
              name="runId"
              pattern={IDENTIFIER}
            >
              <Label>Run ID</Label>
              <Input
                className="font-mono"
                placeholder="seed-2026-08-baseline"
              />
              <FieldError />
            </TextField>
          </Fieldset.Group>
          <div className="flex w-full flex-col gap-1">
            <Label htmlFor="job-images" isRequired>
              Images
            </Label>
            <input
              id="job-images"
              name="images"
              type="file"
              accept=".jpg,.jpeg,.png,.tif,.tiff"
              multiple
              required
              className="input input--full-width"
            />
            <Description>
              JPEG, PNG, or TIFF. Up to 100 files, 64 MiB each and 512 MiB
              total.
            </Description>
          </div>
          <Fieldset.Actions>
            <Button type="submit" variant="primary" size="sm">
              Create job
            </Button>
          </Fieldset.Actions>
        </Fieldset>
      </Form>
    </Card>
  );
}

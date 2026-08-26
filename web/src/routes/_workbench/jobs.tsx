import {
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
  toast,
} from "@heroui/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ImageDropZone } from "../../components/ImageDropZone";
import { Page } from "../../components/Page";
import type { JobStatus } from "../../jobs/schema";
import { getJobs } from "../../server/jobs";

export const Route = createFileRoute("/_workbench/jobs")({
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
                      <RetryButton jobId={job.id} />
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
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);

  return (
    <Card className="p-6">
      <Form
        className="w-full"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          setProgress({
            loaded: 0,
            total: files.reduce((sum, file) => sum + file.size, 0),
          });
          void createJob(form, files, (loaded, total) => {
            setProgress({ loaded, total });
          })
            .then(async () => {
              setFiles([]);
              toast.success("Job created");
              await router.invalidate();
            })
            .catch((cause: unknown) => {
              toast.danger("Job not created", {
                description: errorMessage(cause),
              });
            })
            .finally(() => {
              setProgress(null);
            });
        }}
      >
        <Fieldset>
          <Fieldset.Legend>New recognition job</Fieldset.Legend>
          <Description>
            Dataset names use letters, numbers, dots, dashes, and underscores.
          </Description>
          <Fieldset.Group>
            <TextField
              fullWidth
              isRequired
              isDisabled={progress != null}
              name="dataset"
              pattern={IDENTIFIER}
              autoFocus
            >
              <Label>Dataset</Label>
              <Input className="font-mono" placeholder="seed-2026-08" />
              <FieldError />
            </TextField>
          </Fieldset.Group>
          <div className="flex w-full flex-col gap-1">
            <Label isRequired>Images</Label>
            <ImageDropZone
              files={files}
              onChange={setFiles}
              progress={progress}
            />
          </div>
          <Fieldset.Actions>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isDisabled={progress != null || files.length === 0}
            >
              {progress == null
                ? "Create job"
                : progress.loaded < progress.total
                  ? "Uploading…"
                  : "Creating…"}
            </Button>
          </Fieldset.Actions>
        </Fieldset>
      </Form>
    </Card>
  );
}

function RetryButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="secondary"
      size="sm"
      isDisabled={pending}
      onPress={() => {
        setPending(true);
        void retryJob(jobId)
          .then(async () => {
            toast.success("Job queued again");
            await router.invalidate();
          })
          .catch((cause: unknown) => {
            toast.danger("Job not queued", {
              description: errorMessage(cause),
            });
          })
          .finally(() => {
            setPending(false);
          });
      }}
    >
      Retry
    </Button>
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function retryJob(jobId: string): Promise<void> {
  const response = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
  if (response.ok) {
    return;
  }
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  throw new Error(body?.error ?? `Retry failed (${response.status})`);
}

function createJob(
  form: HTMLFormElement,
  files: File[],
  onProgress: (loaded: number, total: number) => void,
) {
  const data = new FormData(form);
  for (const file of files) {
    data.append("images", file);
  }
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/jobs");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded, event.total);
      }
    };
    request.onload = () => {
      let body: { error?: string } | null;
      try {
        body = JSON.parse(request.responseText) as { error?: string };
      } catch {
        body = null;
      }
      if (body?.error != null) {
        reject(new Error(body.error));
      } else if (request.status >= 400 || body == null) {
        reject(new Error(`Upload failed (${request.status})`));
      } else {
        resolve();
      }
    };
    request.onerror = () => {
      reject(new Error("Upload failed"));
    };
    request.send(data);
  });
}

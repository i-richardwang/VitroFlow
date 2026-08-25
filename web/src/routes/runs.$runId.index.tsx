import {
  Breadcrumbs,
  EmptyState,
  Table,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { REVIEW_STATES, type ReviewState } from "../annotation/schema";
import { QualityWarnings } from "../components/QualityWarnings";
import { ReviewStatusChip, reviewStateLabel } from "../components/ReviewStatus";
import { getRun } from "../server/runs";

export const Route = createFileRoute("/runs/$runId/")({
  loader: ({ params }) => getRun({ data: { runId: params.runId } }),
  component: RunPage,
});

type Filter = ReviewState | "all";

function RunPage() {
  const { runId } = Route.useParams();
  const images = Route.useLoaderData();
  const [filter, setFilter] = useState<Filter>("all");

  const visible =
    filter === "all"
      ? images
      : images.filter((image) => image.review === filter);
  const countOf = (state: Filter) =>
    state === "all"
      ? images.length
      : images.filter((image) => image.review === state).length;

  return (
    <main className="mx-auto max-w-3xl px-8 py-10">
      <Breadcrumbs>
        <Breadcrumbs.Item href="/">Runs</Breadcrumbs.Item>
        <Breadcrumbs.Item>{runId}</Breadcrumbs.Item>
      </Breadcrumbs>
      <h1 className="mt-3 truncate font-mono text-xl font-semibold tracking-tight">
        {runId}
      </h1>

      <ToggleButtonGroup
        className="mt-6"
        aria-label="Review status"
        size="sm"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={new Set([filter])}
        onSelectionChange={(keys) => setFilter([...keys][0] as Filter)}
      >
        {(["all", ...REVIEW_STATES] as const).map((state) => (
          <ToggleButton key={state} id={state}>
            {state === "all" ? "All" : reviewStateLabel(state)}
            <span className="ml-1.5 font-mono tabular-nums text-muted">
              {countOf(state)}
            </span>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Table className="mt-4">
        <Table.ScrollContainer>
          <Table.Content aria-label={`Images in ${runId}`}>
            <Table.Header>
              <Table.Column isRowHeader>Image</Table.Column>
              <Table.Column className="text-right">Instances</Table.Column>
              <Table.Column>Review</Table.Column>
              <Table.Column>Quality</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState className="flex min-h-40 flex-col items-center justify-center gap-1 text-center">
                  <span className="font-medium">No images in this state</span>
                  <span className="text-xs text-muted">
                    Choose another filter to see images
                  </span>
                </EmptyState>
              )}
            >
              {visible.map((image) => (
                <Table.Row
                  key={image.stem}
                  href={`/runs/${runId}/${image.stem}`}
                  className="cursor-(--cursor-interactive)"
                >
                  <Table.Cell className="font-mono font-medium">
                    {image.stem}
                  </Table.Cell>
                  <Table.Cell className="text-right font-mono tabular-nums">
                    {image.instanceCount ?? (
                      <span className="text-muted">—</span>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <ReviewStatusChip state={image.review} />
                  </Table.Cell>
                  <Table.Cell>
                    {image.quality.status === "ok" ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <QualityWarnings quality={image.quality} />
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </main>
  );
}

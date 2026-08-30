import { EmptyState } from "@heroui-pro/react/empty-state";
import { Link, Table } from "@heroui/react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { AddToDatasetDialog } from "../../components/dataset/AddToDatasetDialog";
import { EmptyStateHeading } from "../../components/EmptyStateHeading";
import { RoundDialog } from "../../components/experiment/RoundDialog";
import { Hint } from "../../components/Hint";
import { Page } from "../../components/Page";
import { Timestamp } from "../../components/Timestamp";
import { experimentIdSchema } from "../../experiments/schema";
import { versionSlug } from "../../models/schema";
import { getExperimentGrid } from "../../functions/experiments";
import type { PhotoCell } from "../../server/experiments";

export const Route = createFileRoute("/_workbench/experiments/$experiment/")({
  loader: async ({ params }) => {
    if (!experimentIdSchema.safeParse(params.experiment).success) {
      throw notFound();
    }
    const grid = await getExperimentGrid({
      data: { experiment: params.experiment },
    });
    if (!grid) throw notFound();
    return grid;
  },
  component: ExperimentPage,
});

function ExperimentPage() {
  const { experiment, version, dishes, rounds, photos, datasets } =
    Route.useLoaderData();
  const router = useRouter();

  const waiting = photos.some((photo) => photo.state === "pending");
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void router.invalidate(), 5000);
    return () => window.clearInterval(timer);
  }, [waiting, router]);

  const cells = new Map<string, PhotoCell>();
  for (const photo of photos)
    cells.set(cellKey(photo.dish, photo.round), photo);

  return (
    <Page
      title={experiment.name}
      description={
        <>
          Counting with{" "}
          <span className="font-mono">
            {version.modelId} / {versionSlug(version)}
          </span>
          {rounds.length > 0 ? (
            <>
              , {dishes.length} {dishes.length === 1 ? "dish" : "dishes"} over{" "}
              {rounds.length} {rounds.length === 1 ? "round" : "rounds"}
            </>
          ) : null}
        </>
      }
      actions={
        <>
          {photos.length > 0 ? (
            <AddToDatasetDialog
              modelId={version.modelId}
              photos={photos.map((photo) => ({
                experiment: experiment.id,
                dish: photo.dish,
                round: photo.round,
              }))}
              datasets={datasets}
              label="Add all to dataset"
            />
          ) : null}
          <RoundDialog
            experiment={experiment.id}
            firstRound={rounds.length === 0}
          />
        </>
      }
    >
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={`Counts in ${experiment.name}`}>
            <Table.Header>
              <Table.Column isRowHeader>Dish</Table.Column>
              {rounds.map((round) => (
                <Table.Column key={round.id} className="text-right">
                  <span className="flex flex-col items-end">
                    <span>{round.label}</span>
                    <span className="text-xs font-normal text-muted">
                      <Timestamp value={round.capturedAt} />
                    </span>
                  </span>
                </Table.Column>
              ))}
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyStateHeading>No rounds yet</EmptyStateHeading>
                    <EmptyState.Description>
                      Add the first round to name the dishes.
                    </EmptyState.Description>
                  </EmptyState.Header>
                </EmptyState>
              )}
            >
              {dishes.map((dish) => (
                <Table.Row key={dish.label}>
                  <Table.Cell className="font-mono font-medium">
                    {dish.label}
                  </Table.Cell>
                  {rounds.map((round) => (
                    <Table.Cell
                      key={round.id}
                      className="text-right font-mono tabular-nums"
                    >
                      <Cell
                        experiment={experiment.id}
                        photo={cells.get(cellKey(dish.label, round.id))}
                      />
                    </Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </Page>
  );
}

function cellKey(dish: string, round: string): string {
  return `${round}\0${dish}`;
}

/**
 * A cell shows the reviewed count once a review of the photograph is
 * complete, and the version's count until then.
 */
function Cell({
  experiment,
  photo,
}: {
  experiment: string;
  photo: PhotoCell | undefined;
}) {
  if (!photo) return <span className="text-muted">-</span>;
  const href = `/experiments/${experiment}/${encodeURIComponent(photo.dish)}/${photo.round}`;
  if (photo.reviewed !== null) {
    return (
      <Hint text={`Reviewed; the version counted ${photo.count ?? "nothing"}`}>
        <Link href={href} className="font-semibold text-success">
          {photo.reviewed}
        </Link>
      </Hint>
    );
  }
  if (photo.state === "counted") {
    return <Link href={href}>{photo.count}</Link>;
  }
  return (
    <Hint text={photo.error}>
      <Link
        href={href}
        className={photo.state === "failed" ? "text-danger" : "text-muted"}
      >
        {photo.state}
      </Link>
    </Hint>
  );
}

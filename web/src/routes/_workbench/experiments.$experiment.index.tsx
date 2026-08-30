import { EmptyState } from "@heroui-pro/react/empty-state";
import { Label, Link, ListBox, Select, Table, Tooltip } from "@heroui/react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type ReactElement } from "react";

import { AddToDatasetDialog } from "../../components/dataset/AddToDatasetDialog";
import { RoundDialog } from "../../components/experiment/RoundDialog";
import { Page } from "../../components/Page";
import { experimentIdSchema } from "../../experiments/schema";
import { getExperimentGrid } from "../../functions/experiments";
import { formatReading, read, type Reading } from "../../models/readings";
import { primaryReading } from "../../models/schema";
import type { ExperimentGrid, PhotoCell } from "../../server/experiments";

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
  staticData: {
    crumbs: ({ loaderData }) => {
      const { experiment } = loaderData as ExperimentGrid;
      return [
        { label: "Experiments", href: "/experiments" },
        { label: experiment.name },
      ];
    },
  },
  component: ExperimentPage,
});

function ExperimentPage() {
  const { experiment, model, version, dishes, rounds, photos, datasets } =
    Route.useLoaderData();
  const router = useRouter();
  const [readingId, setReadingId] = useState(primaryReading(model).id);
  const reading =
    model.readings.find((item) => item.id === readingId) ??
    primaryReading(model);

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
      description={version.name}
      actions={
        <>
          {model.readings.length > 1 && (
            <Select
              aria-label="Reading"
              className="w-44"
              variant="secondary"
              selectedKey={reading.id}
              onSelectionChange={(key) =>
                key !== null && setReadingId(String(key))
              }
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {model.readings.map((item) => (
                    <ListBox.Item
                      key={item.id}
                      id={item.id}
                      textValue={item.name}
                    >
                      <Label>{item.name}</Label>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          )}
          {photos.length > 0 ? (
            <AddToDatasetDialog
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
          <Table.Content aria-label={`${reading.name} in ${experiment.name}`}>
            <Table.Header>
              <Table.Column isRowHeader>Dish</Table.Column>
              {rounds.map((round) => (
                <Table.Column key={round.id} className="text-right">
                  {round.label}
                </Table.Column>
              ))}
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Title>No rounds yet</EmptyState.Title>
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
                    <Link
                      href={`/experiments/${experiment.id}/${encodeURIComponent(dish.label)}`}
                    >
                      {dish.label}
                    </Link>
                  </Table.Cell>
                  {rounds.map((round) => (
                    <Table.Cell
                      key={round.id}
                      className="text-right font-mono tabular-nums"
                    >
                      <Cell
                        experiment={experiment.id}
                        reading={reading}
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

/** The reviewer's reading once a review is complete; otherwise the version's. */
function Cell({
  experiment,
  reading,
  photo,
}: {
  experiment: string;
  reading: Reading;
  photo: PhotoCell | undefined;
}) {
  if (!photo) return <span className="text-muted">—</span>;
  const href = `/experiments/${experiment}/${encodeURIComponent(photo.dish)}?round=${photo.round}`;
  const value = (counts: NonNullable<PhotoCell["observed"]>) =>
    formatReading(reading, read(reading, counts));
  if (photo.reviewed) {
    return explain(
      photo.observed && `Version read ${value(photo.observed)}`,
      <Link href={href} className="font-semibold">
        {value(photo.reviewed)}
      </Link>,
    );
  }
  if (photo.observed) {
    return <Link href={href}>{value(photo.observed)}</Link>;
  }
  if (photo.state === "failed") {
    return explain(
      photo.error,
      <Link href={href} className="text-danger">
        Failed
      </Link>,
    );
  }
  return (
    <Link href={href} className="text-muted">
      —
    </Link>
  );
}

function explain(text: string | null, control: ReactElement) {
  if (!text) return control;
  return (
    <Tooltip delay={0}>
      {control}
      <Tooltip.Content className="max-w-xs">{text}</Tooltip.Content>
    </Tooltip>
  );
}

import { EmptyState } from "@heroui-pro/react/empty-state";
import { Label, Link, ListBox, Select, Table, Tooltip } from "@heroui/react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { type ReactElement } from "react";
import { z } from "zod";

import { AddToDatasetDialog } from "../../components/dataset/AddToDatasetDialog";
import { ExperimentMenu } from "../../components/experiment/ExperimentMenu";
import { RoundDialog } from "../../components/experiment/RoundDialog";
import { RoundMenu } from "../../components/experiment/RoundMenu";
import { TreatmentsDialog } from "../../components/experiment/TreatmentsDialog";
import { Page } from "../../components/Page";
import { experimentIdSchema, type Treatment } from "../../experiments/schema";
import { getExperimentGrid } from "../../functions/experiments";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";
import {
  formatReading,
  read,
  summarize,
  type Reading,
  type Tally,
} from "../../models/readings";
import { primaryReading } from "../../models/schema";
import type {
  ExperimentDish,
  ExperimentGrid,
  PhotoCell,
} from "../../experiments/contracts";

export const Route = createFileRoute("/_workbench/experiments/$experiment/")({
  validateSearch: z.object({ reading: z.string().optional().catch(undefined) }),
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
  const {
    experiment,
    model,
    version,
    treatments,
    dishes,
    rounds,
    photos,
    datasets,
  } = Route.useLoaderData();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const { reading: readingId } = Route.useSearch();
  const reading =
    model.readings.find((item) => item.id === readingId) ??
    primaryReading(model);

  const waiting = photos.some((photo) => photo.state === "pending");
  useRouteRefresh(router, 5000, waiting);

  const cells = new Map<string, PhotoCell>();
  for (const photo of photos)
    cells.set(cellKey(photo.dish, photo.round), photo);
  const groups = groupDishes(treatments, dishes);

  return (
    <Page
      title={experiment.name}
      description={
        <span className="flex flex-col gap-1">
          {experiment.description ? (
            <span className="whitespace-pre-line">
              {experiment.description}
            </span>
          ) : null}
          <span className="font-mono text-xs">{version.name}</span>
        </span>
      }
      actions={
        <>
          {model.readings.length > 1 && (
            <Select
              aria-label="Reading"
              className="w-44"
              variant="secondary"
              selectedKey={reading.id}
              onSelectionChange={(key) => {
                if (key === null) return;
                const next = String(key);
                void navigate({
                  replace: true,
                  search: {
                    reading:
                      next === primaryReading(model).id ? undefined : next,
                  },
                });
              }}
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
          <TreatmentsDialog
            experiment={experiment.id}
            treatments={treatments}
            dishes={dishes}
          />
          <RoundDialog
            experiment={experiment.id}
            firstRound={rounds.length === 0}
          />
          <ExperimentMenu experiment={experiment} />
        </>
      }
    >
      {rounds.length === 0 ? (
        <EmptyState size="sm">
          <EmptyState.Header>
            <EmptyState.Title>No rounds yet</EmptyState.Title>
            <EmptyState.Description>
              Add the first round to name the dishes.
            </EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      ) : (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label={`${reading.name} in ${experiment.name}`}>
              <Table.Header>
                <Table.Column isRowHeader>Dish</Table.Column>
                {rounds.map((round) => (
                  <Table.Column key={round.id} className="text-right">
                    <RoundMenu experiment={experiment.id} round={round} />
                  </Table.Column>
                ))}
              </Table.Header>
              <Table.Body>
                {groups.flatMap((group) => [
                  ...(group.kind === "treatment"
                    ? [
                        <Table.Row key={groupKey(group.treatment)}>
                          <Table.Cell className="font-medium">
                            {group.treatment?.name ?? (
                              <span className="text-muted">Unassigned</span>
                            )}
                          </Table.Cell>
                          {rounds.map((round) => (
                            <Table.Cell
                              key={round.id}
                              className="text-right font-mono font-medium tabular-nums"
                            >
                              {group.treatment ? (
                                <MeanCell
                                  reading={reading}
                                  photos={group.dishes.flatMap(
                                    (dish) =>
                                      cells.get(
                                        cellKey(dish.label, round.id),
                                      ) ?? [],
                                  )}
                                />
                              ) : null}
                            </Table.Cell>
                          ))}
                        </Table.Row>,
                      ]
                    : []),
                  ...group.dishes.map((dish) => (
                    <Table.Row key={dish.label}>
                      <Table.Cell
                        className={`font-mono font-medium ${group.kind === "treatment" ? "pl-8" : ""}`}
                      >
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
                  )),
                ])}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      )}
    </Page>
  );
}

function cellKey(dish: string, round: string): string {
  return `${round}\0${dish}`;
}

type DishGroup =
  | { kind: "flat"; dishes: ExperimentDish[] }
  | {
      kind: "treatment";
      treatment: Treatment | null;
      dishes: ExperimentDish[];
    };

function groupDishes(
  treatments: Treatment[],
  dishes: ExperimentDish[],
): DishGroup[] {
  if (treatments.length === 0) return [{ kind: "flat", dishes }];
  const groups: DishGroup[] = treatments.map((treatment) => ({
    kind: "treatment",
    treatment,
    dishes: dishes.filter((dish) => dish.treatment === treatment.id),
  }));
  const unassigned = dishes.filter((dish) => dish.treatment === null);
  if (unassigned.length > 0)
    groups.push({ kind: "treatment", treatment: null, dishes: unassigned });
  return groups;
}

function groupKey(treatment: Treatment | null): string {
  return treatment ? `treatment:${treatment.id}` : "unassigned";
}

function tallyShown(photo: PhotoCell): Tally | null {
  return photo.reviewed ?? photo.observed;
}

function MeanCell({
  reading,
  photos,
}: {
  reading: Reading;
  photos: PhotoCell[];
}) {
  const tallies = photos.flatMap((photo) => {
    const counts = tallyShown(photo);
    return counts ? [counts] : [];
  });
  if (tallies.length === 0) return <span className="text-muted">—</span>;
  const summary = summarize(reading, tallies);
  if (summary.value === null) return <span className="text-muted">—</span>;
  return explain(
    `Mean of ${summary.sampleSize} ${summary.sampleSize === 1 ? "dish" : "dishes"}`,
    <span>{formatReading(reading, summary.value)}</span>,
  );
}

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

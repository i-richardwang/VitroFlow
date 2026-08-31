import { ActionBar } from "@heroui-pro/react/action-bar";
import { EmptyState } from "@heroui-pro/react/empty-state";
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Dropdown,
  Label,
  Link,
  ListBox,
  Select,
  Separator,
  Table,
  toast,
  Tooltip,
  type Selection,
} from "@heroui/react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useState, type ReactElement } from "react";
import { z } from "zod";

import { DishTreatmentMenu } from "../../components/experiment/DishTreatmentMenu";
import { ExperimentMenu } from "../../components/experiment/ExperimentMenu";
import { RoundDialog } from "../../components/experiment/RoundDialog";
import { RoundMenu } from "../../components/experiment/RoundMenu";
import { TreatmentChoices } from "../../components/experiment/TreatmentChoices";
import { TreatmentDot } from "../../components/experiment/TreatmentDot";
import { CloseIcon } from "../../components/icons";
import { Page } from "../../components/Page";
import { inferTreatments } from "../../experiments/naming";
import { experimentIdSchema, type Treatment } from "../../experiments/schema";
import {
  getExperimentGrid,
  groupDishesByName,
  placeDishes,
} from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";
import {
  formatReading,
  read,
  summarize,
  type Reading,
  type Tally,
} from "../../models/readings";
import { primaryReading, versionSlug } from "../../models/schema";
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

  const hasTreatments = treatments.length > 0;
  const groups = groupDishes(treatments, dishes);
  const roster = groups.flatMap((group) => group.dishes);
  const summaryKeys = hasTreatments
    ? groups.map((group) => groupKey(group.treatment))
    : [];
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());
  const selected = pickedLabels(selectedKeys, roster);

  return (
    <Page
      title={experiment.name}
      description={[
        experiment.material,
        experiment.explant,
        experiment.medium,
        versionSlug(version),
      ]
        .filter(Boolean)
        .join(" · ")}
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
          <RoundDialog
            experiment={experiment.id}
            firstRound={rounds.length === 0}
          />
          <ExperimentMenu
            experiment={experiment}
            treatments={treatments}
            photos={photos}
            datasets={datasets}
          />
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
        <>
          <UnassignedAlert experiment={experiment.id} dishes={dishes} />
          <Table>
            <Table.ScrollContainer>
              <Table.Content
                aria-label={`${reading.name} in ${experiment.name}`}
                selectionMode={hasTreatments ? "multiple" : "none"}
                disabledKeys={summaryKeys}
                selectedKeys={selectedKeys}
                onSelectionChange={setSelectedKeys}
              >
                <Table.Header>
                  {hasTreatments ? (
                    <Table.Column className="pe-0">
                      <Checkbox aria-label="Select all dishes" slot="selection">
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                        </Checkbox.Content>
                      </Checkbox>
                    </Table.Column>
                  ) : null}
                  <Table.Column isRowHeader>Dish</Table.Column>
                  {rounds.map((round) => (
                    <Table.Column key={round.id} className="text-right">
                      <RoundMenu experiment={experiment.id} round={round} />
                    </Table.Column>
                  ))}
                </Table.Header>
                <Table.Body>
                  {groups.flatMap((group) => [
                    ...(hasTreatments
                      ? [
                          <Table.Row
                            key={groupKey(group.treatment)}
                            id={groupKey(group.treatment)}
                            className="bg-surface/30 [--disabled-opacity:1]"
                          >
                            <Table.Cell className="pe-0" />
                            <Table.Cell className="font-medium">
                              <span className="flex items-center gap-2">
                                <TreatmentDot
                                  position={group.treatment?.position ?? null}
                                />
                                {group.treatment?.name ?? (
                                  <span className="text-muted">Unassigned</span>
                                )}
                              </span>
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
                      <Table.Row
                        key={dishKey(dish.label)}
                        id={dishKey(dish.label)}
                      >
                        {hasTreatments ? (
                          <Table.Cell className="pe-0">
                            <Checkbox
                              aria-label={`Select dish ${dish.label}`}
                              slot="selection"
                              variant="secondary"
                            >
                              <Checkbox.Content>
                                <Checkbox.Control>
                                  <Checkbox.Indicator />
                                </Checkbox.Control>
                              </Checkbox.Content>
                            </Checkbox>
                          </Table.Cell>
                        ) : null}
                        <Table.Cell
                          className={`font-mono font-medium ${hasTreatments ? "pl-8" : ""}`}
                        >
                          <span className="flex items-center gap-1">
                            {hasTreatments ? (
                              <DishTreatmentMenu
                                experiment={experiment.id}
                                dish={dish}
                                treatments={treatments}
                              />
                            ) : null}
                            <Link
                              href={`/experiments/${experiment.id}/${encodeURIComponent(dish.label)}`}
                            >
                              {dish.label}
                            </Link>
                          </span>
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
          {hasTreatments ? (
            <AssignmentBar
              experiment={experiment.id}
              treatments={treatments}
              selected={selected}
              onDone={() => setSelectedKeys(new Set())}
            />
          ) : null}
        </>
      )}
    </Page>
  );
}

function AssignmentBar({
  experiment,
  treatments,
  selected,
  onDone,
}: {
  experiment: string;
  treatments: Treatment[];
  selected: string[];
  onDone: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  return (
    <ActionBar isOpen={selected.length > 0} aria-label="Selected dishes">
      <ActionBar.Prefix>
        <Chip size="sm" className="tabular-nums">
          {selected.length}
        </Chip>
      </ActionBar.Prefix>
      <Separator />
      <ActionBar.Content>
        <Dropdown>
          <Button size="sm" variant="ghost" isDisabled={busy}>
            Assign to…
          </Button>
          <TreatmentChoices
            label={`Treatment of ${selected.length} selected dishes`}
            treatments={treatments}
            onPick={(treatment) => {
              void run(
                () =>
                  placeDishes({
                    data: { experiment, dishes: selected, treatment },
                  }),
                "Dishes not assigned",
              ).then(async (result) => {
                if (!result.ok) return;
                onDone();
                await router.invalidate();
              });
            }}
          />
        </Dropdown>
      </ActionBar.Content>
      <Separator />
      <ActionBar.Suffix>
        <Tooltip delay={0}>
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            isDisabled={busy}
            aria-label="Clear selection"
            onPress={onDone}
          >
            <CloseIcon />
          </Button>
          <Tooltip.Content>Clear</Tooltip.Content>
        </Tooltip>
      </ActionBar.Suffix>
    </ActionBar>
  );
}

function UnassignedAlert({
  experiment,
  dishes,
}: {
  experiment: string;
  dishes: ExperimentDish[];
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const unassigned = dishes.filter((dish) => dish.treatment === null);
  if (unassigned.length === 0) return null;
  const unassignedNames = new Set(unassigned.map((dish) => dish.label));
  const groupable = inferTreatments(dishes.map((dish) => dish.label)).some(
    (group) => group.dishes.some((dish) => unassignedNames.has(dish)),
  );
  return (
    <Alert status="warning">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          {unassigned.length === 1
            ? "1 dish is not assigned"
            : `${unassigned.length} dishes are not assigned`}
        </Alert.Title>
      </Alert.Content>
      {groupable ? (
        <Button
          size="sm"
          variant="secondary"
          isDisabled={busy}
          onPress={() => {
            void run(
              () => groupDishesByName({ data: { experiment } }),
              "Dishes not grouped",
            ).then(async (result) => {
              if (!result.ok) return;
              toast.success(
                `${result.value} ${result.value === 1 ? "dish" : "dishes"} grouped by name`,
              );
              await router.invalidate();
            });
          }}
        >
          Group by dish name
        </Button>
      ) : null}
    </Alert>
  );
}

function cellKey(dish: string, round: string): string {
  return `${round}\0${dish}`;
}

interface DishGroup {
  treatment: Treatment | null;
  dishes: ExperimentDish[];
}

function groupDishes(
  treatments: Treatment[],
  dishes: ExperimentDish[],
): DishGroup[] {
  if (treatments.length === 0) return [{ treatment: null, dishes }];
  const groups: DishGroup[] = treatments.map((treatment) => ({
    treatment,
    dishes: dishes.filter((dish) => dish.treatment === treatment.id),
  }));
  const unassigned = dishes.filter((dish) => dish.treatment === null);
  if (unassigned.length > 0)
    groups.push({ treatment: null, dishes: unassigned });
  return groups;
}

function groupKey(treatment: Treatment | null): string {
  return treatment ? `group:${treatment.id}` : "group:unassigned";
}

function dishKey(label: string): string {
  return `dish:${label}`;
}

function pickedLabels(keys: Selection, dishes: ExperimentDish[]): string[] {
  if (keys === "all") return dishes.map((dish) => dish.label);
  const labels = new Map(
    dishes.map((dish) => [dishKey(dish.label), dish.label]),
  );
  return [...keys].flatMap((key) => labels.get(String(key)) ?? []);
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
  const tallies = photos
    .map(tallyShown)
    .filter((tally): tally is Tally => tally !== null);
  const summary = summarize(reading, tallies);
  if (summary.value === null) return <span className="text-muted">—</span>;
  const formatted = formatReading(reading, summary.value);
  return (
    <span
      aria-label={`${formatted}, mean of ${summary.sampleSize} ${summary.sampleSize === 1 ? "dish" : "dishes"}`}
    >
      {formatted}
      <span className="ml-1 text-xs text-muted">n={summary.sampleSize}</span>
    </span>
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

import { ActionBar } from "@heroui-pro/react/action-bar";
import { EmptyState } from "@heroui-pro/react/empty-state";
import {
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
  Tooltip,
  type Selection,
} from "@heroui/react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useState, type ReactElement } from "react";
import { z } from "zod";

import { DishMenu } from "../../components/experiment/DishMenu";
import { DesignDialog } from "../../components/experiment/DesignDialog";
import { ExperimentMenu } from "../../components/experiment/ExperimentMenu";
import { NewObservationDialog } from "../../components/experiment/NewObservationDialog";
import { FilePhotosDialog } from "../../components/experiment/FilePhotosDialog";
import { ObservationMenu } from "../../components/experiment/ObservationMenu";
import { TreatmentChoices } from "../../components/experiment/TreatmentChoices";
import { TreatmentDot } from "../../components/experiment/TreatmentDot";
import { CloseIcon, ExperimentsIcon } from "../../components/icons";
import { Page } from "../../components/Page";
import {
  experimentIdSchema,
  formatFactors,
  observationLabel,
  type ExperimentObservation,
  type Treatment,
} from "../../experiments/schema";
import {
  DISH_EVENT_LABELS,
  dishIsAvailableAt,
  dishIsIncludedInAnalysis,
  latestActiveDishEvent,
} from "../../experiments/dish-events";
import { designIssues } from "../../experiments/design";
import { getExperimentGrid, placeDishes } from "../../functions/experiments";
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

type Dialog = "design" | "observation";

function ExperimentPage() {
  const {
    experiment,
    model,
    version,
    treatments,
    dishes,
    observations,
    photos,
    datasets,
  } = Route.useLoaderData();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const { reading: readingId } = Route.useSearch();
  const reading =
    model.readings.find((item) => item.id === readingId) ??
    primaryReading(model);

  const [open, setOpen] = useState<Dialog | null>(null);
  const [filing, setFiling] = useState<ExperimentObservation | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());

  const waiting = photos.some((photo) => photo.state === "pending");
  useRouteRefresh(router, 5000, waiting);

  const cells = new Map(
    photos.map((photo) => [cellKey(photo.dish, photo.observation), photo]),
  );
  const ordinals = new Map(
    observations.map((observation) => [observation.id, observation.ordinal]),
  );
  const designLocked = observations.length > 0;
  const unresolvedDesign = designIssues(treatments, dishes);
  const designReady = unresolvedDesign.length === 0;
  const groups = groupDishes(treatments, dishes);
  const summaryKeys = groups.map((group) => groupKey(group.treatment));
  const selected = pickedDishes(selectedKeys, dishes);

  return (
    <Page
      title={experiment.name}
      description={[
        experiment.material,
        experiment.explant,
        experiment.medium,
        `Inoculated ${experiment.inoculatedOn}`,
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
          <Button variant="secondary" onPress={() => setOpen("design")}>
            Design
          </Button>
          <Button
            variant="primary"
            onPress={() => setOpen("observation")}
            isDisabled={!designReady}
          >
            New observation
          </Button>
          <ExperimentMenu
            experiment={experiment}
            photos={photos}
            datasets={datasets}
            designLocked={designLocked}
          />
        </>
      }
    >
      {dishes.length === 0 ? (
        <EmptyState size="sm">
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <ExperimentsIcon />
            </EmptyState.Media>
            <EmptyState.Title>No dishes yet</EmptyState.Title>
            <EmptyState.Description>
              Write the design first: the conditions being compared and the
              dishes that replicate them.
            </EmptyState.Description>
          </EmptyState.Header>
          <EmptyState.Content>
            <Button variant="primary" onPress={() => setOpen("design")}>
              Write the design
            </Button>
          </EmptyState.Content>
        </EmptyState>
      ) : observations.length === 0 ? (
        <EmptyState size="sm">
          <EmptyState.Header>
            <EmptyState.Title>No observations yet</EmptyState.Title>
            <EmptyState.Description>
              {designReady
                ? `${dishes.length} ${dishes.length === 1 ? "dish is" : "dishes are"} waiting to be photographed.`
                : unresolvedDesign[0]}
            </EmptyState.Description>
          </EmptyState.Header>
          <EmptyState.Content>
            <Button
              variant="primary"
              isDisabled={!designReady}
              onPress={() => setOpen("observation")}
            >
              New observation
            </Button>
          </EmptyState.Content>
        </EmptyState>
      ) : (
        <>
          <Table>
            <Table.ScrollContainer>
              <Table.Content
                aria-label={`${reading.name} in ${experiment.name}`}
                selectionMode={designLocked ? "none" : "multiple"}
                disabledKeys={summaryKeys}
                selectedKeys={selectedKeys}
                onSelectionChange={setSelectedKeys}
              >
                <Table.Header>
                  <Table.Column className="pe-0">
                    <Checkbox aria-label="Select all dishes" slot="selection">
                      <Checkbox.Content>
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                      </Checkbox.Content>
                    </Checkbox>
                  </Table.Column>
                  <Table.Column isRowHeader>Dish</Table.Column>
                  {observations.map((observation) => (
                    <Table.Column key={observation.id} className="text-right">
                      <ObservationMenu
                        experiment={experiment.id}
                        observation={observation}
                        dishes={dishes.filter((dish) =>
                          dishIsAvailableAt(dish.events, observation, ordinals),
                        )}
                        photographed={photographedIn(photos, observation.id)}
                      />
                    </Table.Column>
                  ))}
                </Table.Header>
                <Table.Body>
                  {groups.flatMap((group) => [
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
                            <span className="text-muted">No treatment</span>
                          )}
                          {group.treatment ? (
                            <span className="max-w-64 truncate text-xs font-normal text-muted">
                              {formatFactors(group.treatment.factors) ||
                                group.treatment.note ||
                                "Reference condition"}
                            </span>
                          ) : null}
                        </span>
                      </Table.Cell>
                      {observations.map((observation) => (
                        <Table.Cell
                          key={observation.id}
                          className="text-right font-mono font-medium tabular-nums"
                        >
                          <TreatmentCell
                            reading={reading}
                            observation={observation}
                            ordinals={ordinals}
                            dishes={group.dishes}
                            cells={cells}
                          />
                        </Table.Cell>
                      ))}
                    </Table.Row>,
                    ...group.dishes.map((dish) => (
                      <Table.Row key={dishKey(dish.id)} id={dishKey(dish.id)}>
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
                        <Table.Cell className="pl-8 font-mono font-medium">
                          <span className="flex items-center gap-2">
                            <DishMenu
                              experiment={experiment.id}
                              dish={dish}
                              treatments={treatments}
                              observations={observations}
                              designLocked={designLocked}
                            />
                            <Link
                              href={`/experiments/${experiment.id}/${dish.id}`}
                            >
                              {dish.label}
                            </Link>
                            <DishEventChip
                              dish={dish}
                              observations={observations}
                            />
                            <span className="text-xs font-normal text-muted">
                              {dish.initialExplantCount} explant
                              {dish.initialExplantCount === 1 ? "" : "s"}
                            </span>
                          </span>
                        </Table.Cell>
                        {observations.map((observation) => (
                          <Table.Cell
                            key={observation.id}
                            className="text-right font-mono tabular-nums"
                          >
                            <Cell
                              experiment={experiment.id}
                              reading={reading}
                              dish={dish}
                              photo={cells.get(
                                cellKey(dish.id, observation.id),
                              )}
                              counted={dishIsIncludedInAnalysis(
                                dish.events,
                                observation,
                                ordinals,
                              )}
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
          {!designLocked ? (
            <AssignmentBar
              experiment={experiment.id}
              treatments={treatments}
              selected={selected}
              onDone={() => setSelectedKeys(new Set())}
            />
          ) : null}
        </>
      )}

      <DesignDialog
        experiment={experiment.id}
        treatments={treatments}
        dishes={dishes}
        designLocked={designLocked}
        isOpen={open === "design"}
        onClose={() => setOpen(null)}
      />
      <NewObservationDialog
        experiment={experiment.id}
        inoculatedOn={experiment.inoculatedOn}
        isOpen={open === "observation"}
        onClose={() => setOpen(null)}
        onCreated={(observation) => {
          setOpen(null);
          setFiling(observation);
        }}
      />
      {filing ? (
        <FilePhotosDialog
          experiment={experiment.id}
          observation={filing}
          dishes={dishes.filter((dish) =>
            dishIsAvailableAt(dish.events, filing, ordinals),
          )}
          photographed={photographedIn(photos, filing.id)}
          onClose={() => setFiling(null)}
        />
      ) : null}
    </Page>
  );
}

function photographedIn(
  photos: PhotoCell[],
  observation: string,
): ReadonlySet<string> {
  return new Set(
    photos
      .filter((photo) => photo.observation === observation)
      .map((photo) => photo.dish),
  );
}

function DishEventChip({
  dish,
  observations,
}: {
  dish: ExperimentDish;
  observations: ExperimentObservation[];
}) {
  const ordinals = new Map(
    observations.map((observation) => [observation.id, observation.ordinal]),
  );
  const event = latestActiveDishEvent(dish.events, ordinals);
  if (!event) return null;
  const found = observations.find(
    (observation) => observation.id === event.observation,
  );
  const detail = [
    found ? `at ${observationLabel(found)}` : null,
    event.note || null,
  ]
    .filter(Boolean)
    .join(" · ");
  const chip = (
    <Chip
      size="sm"
      variant="soft"
      color={event.type === "contaminated" ? "warning" : "default"}
    >
      {DISH_EVENT_LABELS[event.type]}
    </Chip>
  );
  if (!detail) return chip;
  return (
    <Tooltip delay={0}>
      {chip}
      <Tooltip.Content>{detail}</Tooltip.Content>
    </Tooltip>
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

function cellKey(dish: string, observation: string): string {
  return `${observation}\0${dish}`;
}

interface DishGroup {
  treatment: Treatment | null;
  dishes: ExperimentDish[];
}

function groupDishes(
  treatments: Treatment[],
  dishes: ExperimentDish[],
): DishGroup[] {
  const groups: DishGroup[] = treatments.map((treatment) => ({
    treatment,
    dishes: dishes.filter((dish) => dish.treatment === treatment.id),
  }));
  const unassigned = dishes.filter((dish) => dish.treatment === null);
  if (unassigned.length > 0) {
    groups.push({ treatment: null, dishes: unassigned });
  }
  return groups;
}

function groupKey(treatment: Treatment | null): string {
  return treatment ? `group:${treatment.id}` : "group:unassigned";
}

function dishKey(dish: string): string {
  return `dish:${dish}`;
}

function pickedDishes(keys: Selection, dishes: ExperimentDish[]): string[] {
  if (keys === "all") return dishes.map((dish) => dish.id);
  const byKey = new Map(dishes.map((dish) => [dishKey(dish.id), dish.id]));
  return [...keys].flatMap((key) => byKey.get(String(key)) ?? []);
}

function tallyShown(photo: PhotoCell): Tally | null {
  return photo.reviewed ?? photo.observed;
}

function TreatmentCell({
  reading,
  observation,
  ordinals,
  dishes,
  cells,
}: {
  reading: Reading;
  observation: ExperimentObservation;
  ordinals: Map<string, number>;
  dishes: ExperimentDish[];
  cells: Map<string, PhotoCell>;
}) {
  const replicates = dishes.filter((dish) =>
    dishIsIncludedInAnalysis(dish.events, observation, ordinals),
  );
  const excluded = dishes.length - replicates.length;
  const tallies = replicates.flatMap((dish) => {
    const photo = cells.get(cellKey(dish.id, observation.id));
    const tally = photo ? tallyShown(photo) : null;
    return tally ? [tally] : [];
  });
  const summary = summarize(reading, tallies);
  const sample = `n=${summary.sampleSize}/${replicates.length}`;
  const note =
    excluded > 0 ? (
      <span className="ml-1 text-xs font-normal text-warning">
        {excluded} excluded
      </span>
    ) : null;
  if (summary.value === null) {
    return (
      <span className="text-muted">
        — <span className="text-xs">{sample}</span>
        {note}
      </span>
    );
  }
  const mean = formatReading(reading, summary.value);
  const spread =
    summary.deviation === null
      ? null
      : formatReading(reading, summary.deviation);
  return (
    <span
      aria-label={`${mean}, mean of ${summary.sampleSize} ${summary.sampleSize === 1 ? "dish" : "dishes"}`}
    >
      {mean}
      {spread ? (
        <span className="text-xs font-normal text-muted"> ± {spread}</span>
      ) : null}
      <span className="ml-1 text-xs font-normal text-muted">{sample}</span>
      {note}
    </span>
  );
}

function Cell({
  experiment,
  reading,
  dish,
  photo,
  counted,
}: {
  experiment: string;
  reading: Reading;
  dish: ExperimentDish;
  photo: PhotoCell | undefined;
  counted: boolean;
}) {
  if (!photo) return <span className="text-muted">Empty</span>;
  const href = `/experiments/${experiment}/${dish.id}?observation=${photo.observation}`;
  const value = (counts: Tally) =>
    formatReading(reading, read(reading, counts));
  const dimmed = counted ? "" : "text-muted line-through";
  if (photo.reviewed) {
    return explain(
      [
        photo.observed ? `Version read ${value(photo.observed)}` : null,
        counted ? null : "Not counted: the dish was lost by this observation",
      ]
        .filter(Boolean)
        .join(" · "),
      <Link href={href} className={`font-semibold ${dimmed}`}>
        {value(photo.reviewed)}
      </Link>,
    );
  }
  if (photo.observed) {
    return explain(
      counted ? null : "Not counted: the dish was lost by this observation",
      <Link href={href} className={dimmed}>
        {value(photo.observed)}
      </Link>,
    );
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
      Pending
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

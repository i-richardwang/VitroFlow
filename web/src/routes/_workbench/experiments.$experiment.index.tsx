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

import { ObservationUnitMenu } from "../../components/experiment/ObservationUnitMenu";
import { DesignDialog } from "../../components/experiment/DesignDialog";
import { ExperimentMenu } from "../../components/experiment/ExperimentMenu";
import { NewObservationDialog } from "../../components/experiment/NewObservationDialog";
import { AssignImagesDialog } from "../../components/experiment/AssignImagesDialog";
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
  CULTURE_EVENT_LABELS,
  observationUnitIsAvailableAt,
  observationUnitIsIncludedInAnalysis,
  latestActiveCultureEvent,
} from "../../experiments/culture-events";
import { designIssues } from "../../experiments/design";
import {
  assignObservationUnitsToTreatment,
  getExperimentGrid,
} from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";
import {
  formatMetric,
  computeMetric,
  summarizeMetric,
  type DerivedMetric,
  type Tally,
} from "../../models/metrics";
import { primaryMetric, versionSlug } from "../../models/schema";
import type {
  ObservationUnit,
  ExperimentGrid,
  ObservationImageCell,
} from "../../experiments/contracts";

export const Route = createFileRoute("/_workbench/experiments/$experiment/")({
  validateSearch: z.object({ metric: z.string().optional().catch(undefined) }),
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
    observationUnits,
    observations,
    images,
    datasets,
  } = Route.useLoaderData();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const { metric: metricId } = Route.useSearch();
  const metric =
    model.metrics.find((item) => item.id === metricId) ?? primaryMetric(model);

  const [open, setOpen] = useState<Dialog | null>(null);
  const [assigning, setAssigning] = useState<ExperimentObservation | null>(
    null,
  );
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());

  const waiting = images.some((image) => image.state === "pending");
  useRouteRefresh(router, 5000, waiting);

  const cells = new Map(
    images.map((image) => [
      cellKey(image.observationUnit, image.observation),
      image,
    ]),
  );
  const ordinals = new Map(
    observations.map((observation) => [observation.id, observation.ordinal]),
  );
  const designLocked = observations.length > 0;
  const unresolvedDesign = designIssues(treatments, observationUnits);
  const designReady = unresolvedDesign.length === 0;
  const groups = groupObservationUnits(treatments, observationUnits);
  const summaryKeys = groups.map((group) => groupKey(group.treatment));
  const selected = pickedObservationUnits(selectedKeys, observationUnits);

  return (
    <Page
      title={experiment.name}
      description={[
        experiment.plantMaterial,
        experiment.explantType,
        experiment.baseMedium,
        `Inoculated ${experiment.inoculatedOn}`,
        versionSlug(version),
      ]
        .filter(Boolean)
        .join(" · ")}
      actions={
        <>
          {model.metrics.length > 1 && (
            <Select
              aria-label="Metric"
              className="w-44"
              variant="secondary"
              selectedKey={metric.id}
              onSelectionChange={(key) => {
                if (key === null) return;
                const next = String(key);
                void navigate({
                  replace: true,
                  search: {
                    metric: next === primaryMetric(model).id ? undefined : next,
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
                  {model.metrics.map((item) => (
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
            images={images}
            datasets={datasets}
            designLocked={designLocked}
          />
        </>
      }
    >
      {observationUnits.length === 0 ? (
        <EmptyState size="sm">
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <ExperimentsIcon />
            </EmptyState.Media>
            <EmptyState.Title>No observation units yet</EmptyState.Title>
            <EmptyState.Description>
              Write the design first: the conditions being compared and the
              observation units that replicate them.
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
                ? `${observationUnits.length} ${observationUnits.length === 1 ? "observation unit is" : "observation units are"} ready for the first observation.`
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
                aria-label={`${metric.name} in ${experiment.name}`}
                selectionMode={designLocked ? "none" : "multiple"}
                disabledKeys={summaryKeys}
                selectedKeys={selectedKeys}
                onSelectionChange={setSelectedKeys}
              >
                <Table.Header>
                  <Table.Column className="pe-0">
                    <Checkbox
                      aria-label="Select all observation units"
                      slot="selection"
                    >
                      <Checkbox.Content>
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                      </Checkbox.Content>
                    </Checkbox>
                  </Table.Column>
                  <Table.Column isRowHeader>Observation unit</Table.Column>
                  {observations.map((observation) => (
                    <Table.Column key={observation.id} className="text-right">
                      <ObservationMenu
                        experiment={experiment.id}
                        observation={observation}
                        observationUnits={observationUnits.filter(
                          (observationUnit) =>
                            observationUnitIsAvailableAt(
                              observationUnit.events,
                              observation,
                              ordinals,
                            ),
                        )}
                        assigned={assignedIn(images, observation.id)}
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
                                "No treatment factors specified"}
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
                            metric={metric}
                            observation={observation}
                            ordinals={ordinals}
                            observationUnits={group.observationUnits}
                            cells={cells}
                          />
                        </Table.Cell>
                      ))}
                    </Table.Row>,
                    ...group.observationUnits.map((observationUnit) => (
                      <Table.Row
                        key={observationUnitKey(observationUnit.id)}
                        id={observationUnitKey(observationUnit.id)}
                      >
                        <Table.Cell className="pe-0">
                          <Checkbox
                            aria-label={`Select observation unit ${observationUnit.code}`}
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
                            <ObservationUnitMenu
                              experiment={experiment.id}
                              observationUnit={observationUnit}
                              treatments={treatments}
                              observations={observations}
                              designLocked={designLocked}
                            />
                            <Link
                              href={`/experiments/${experiment.id}/${observationUnit.id}`}
                            >
                              {observationUnit.code}
                            </Link>
                            <CultureEventChip
                              observationUnit={observationUnit}
                              observations={observations}
                            />
                            <span className="text-xs font-normal text-muted">
                              {observationUnit.initialExplantCount} explant
                              {observationUnit.initialExplantCount === 1
                                ? ""
                                : "s"}
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
                              metric={metric}
                              observationUnit={observationUnit}
                              image={cells.get(
                                cellKey(observationUnit.id, observation.id),
                              )}
                              counted={observationUnitIsIncludedInAnalysis(
                                observationUnit.events,
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
        observationUnits={observationUnits}
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
          setAssigning(observation);
        }}
      />
      {assigning ? (
        <AssignImagesDialog
          experiment={experiment.id}
          observation={assigning}
          observationUnits={observationUnits.filter((observationUnit) =>
            observationUnitIsAvailableAt(
              observationUnit.events,
              assigning,
              ordinals,
            ),
          )}
          assigned={assignedIn(images, assigning.id)}
          onClose={() => setAssigning(null)}
        />
      ) : null}
    </Page>
  );
}

function assignedIn(
  images: ObservationImageCell[],
  observation: string,
): ReadonlySet<string> {
  return new Set(
    images
      .filter((image) => image.observation === observation)
      .map((image) => image.observationUnit),
  );
}

function CultureEventChip({
  observationUnit,
  observations,
}: {
  observationUnit: ObservationUnit;
  observations: ExperimentObservation[];
}) {
  const ordinals = new Map(
    observations.map((observation) => [observation.id, observation.ordinal]),
  );
  const event = latestActiveCultureEvent(observationUnit.events, ordinals);
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
      {CULTURE_EVENT_LABELS[event.type]}
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
    <ActionBar
      isOpen={selected.length > 0}
      aria-label="Selected observation units"
    >
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
            label={`Treatment of ${selected.length} selected observation units`}
            treatments={treatments}
            onPick={(treatment) => {
              void run(
                () =>
                  assignObservationUnitsToTreatment({
                    data: { experiment, observationUnits: selected, treatment },
                  }),
                "Observation units not assigned",
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

function cellKey(observationUnit: string, observation: string): string {
  return `${observation}\0${observationUnit}`;
}

interface ObservationUnitGroup {
  treatment: Treatment | null;
  observationUnits: ObservationUnit[];
}

function groupObservationUnits(
  treatments: Treatment[],
  observationUnits: ObservationUnit[],
): ObservationUnitGroup[] {
  const groups: ObservationUnitGroup[] = treatments.map((treatment) => ({
    treatment,
    observationUnits: observationUnits.filter(
      (observationUnit) => observationUnit.treatment === treatment.id,
    ),
  }));
  const unassigned = observationUnits.filter(
    (observationUnit) => observationUnit.treatment === null,
  );
  if (unassigned.length > 0) {
    groups.push({ treatment: null, observationUnits: unassigned });
  }
  return groups;
}

function groupKey(treatment: Treatment | null): string {
  return treatment ? `group:${treatment.id}` : "group:unassigned";
}

function observationUnitKey(observationUnit: string): string {
  return `unit:${observationUnit}`;
}

function pickedObservationUnits(
  keys: Selection,
  observationUnits: ObservationUnit[],
): string[] {
  if (keys === "all")
    return observationUnits.map((observationUnit) => observationUnit.id);
  const byKey = new Map(
    observationUnits.map((observationUnit) => [
      observationUnitKey(observationUnit.id),
      observationUnit.id,
    ]),
  );
  return [...keys].flatMap((key) => byKey.get(String(key)) ?? []);
}

function tallyShown(image: ObservationImageCell): Tally | null {
  return image.annotationTally ?? image.detectionTally;
}

function TreatmentCell({
  metric,
  observation,
  ordinals,
  observationUnits,
  cells,
}: {
  metric: DerivedMetric;
  observation: ExperimentObservation;
  ordinals: Map<string, number>;
  observationUnits: ObservationUnit[];
  cells: Map<string, ObservationImageCell>;
}) {
  const replicates = observationUnits.filter((observationUnit) =>
    observationUnitIsIncludedInAnalysis(
      observationUnit.events,
      observation,
      ordinals,
    ),
  );
  const excluded = observationUnits.length - replicates.length;
  const tallies = replicates.flatMap((observationUnit) => {
    const image = cells.get(cellKey(observationUnit.id, observation.id));
    const tally = image ? tallyShown(image) : null;
    return tally ? [tally] : [];
  });
  const summary = summarizeMetric(metric, tallies);
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
  const mean = formatMetric(metric, summary.value);
  const spread =
    summary.deviation === null ? null : formatMetric(metric, summary.deviation);
  return (
    <span
      aria-label={`${mean}, mean of ${summary.sampleSize} ${summary.sampleSize === 1 ? "observation unit" : "observation units"}`}
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
  metric,
  observationUnit,
  image,
  counted,
}: {
  experiment: string;
  metric: DerivedMetric;
  observationUnit: ObservationUnit;
  image: ObservationImageCell | undefined;
  counted: boolean;
}) {
  if (!image) return <span className="text-muted">Empty</span>;
  const href = `/experiments/${experiment}/${observationUnit.id}?observation=${image.observation}`;
  const value = (counts: Tally) =>
    formatMetric(metric, computeMetric(metric, counts));
  const dimmed = counted ? "" : "text-muted line-through";
  if (image.annotationTally) {
    return explain(
      [
        image.detectionTally ? `Analyzed ${value(image.detectionTally)}` : null,
        counted ? null : "Excluded from analysis at this observation",
      ]
        .filter(Boolean)
        .join(" · "),
      <Link href={href} className={`font-semibold ${dimmed}`}>
        {value(image.annotationTally)}
      </Link>,
    );
  }
  if (image.detectionTally) {
    return explain(
      counted ? null : "Excluded from analysis at this observation",
      <Link href={href} className={dimmed}>
        {value(image.detectionTally)}
      </Link>,
    );
  }
  if (image.state === "failed") {
    return explain(
      image.error,
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

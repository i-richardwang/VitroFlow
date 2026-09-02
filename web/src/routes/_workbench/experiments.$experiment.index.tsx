import { ActionBar } from "@heroui-pro/react/action-bar";
import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import { EmptyState } from "@heroui-pro/react/empty-state";
import {
  Alert,
  Button,
  Chip,
  Dropdown,
  Link,
  ListBox,
  Select,
  Separator,
  Tooltip,
  type Selection,
} from "@heroui/react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useMemo, useState, type ReactElement } from "react";
import { z } from "zod";

import { AddObservationUnitsDialog } from "../../components/experiment/AddObservationUnitsDialog";
import { ExperimentMenu } from "../../components/experiment/ExperimentMenu";
import { NewObservationDialog } from "../../components/experiment/NewObservationDialog";
import { ObservationMenu } from "../../components/experiment/ObservationMenu";
import { ObservationUnitMenu } from "../../components/experiment/ObservationUnitMenu";
import { TreatmentDialog } from "../../components/experiment/TreatmentDialog";
import {
  ObservationUnitTreatmentMenu,
  TreatmentChoices,
} from "../../components/experiment/TreatmentChoices";
import { Hint } from "../../components/Hint";
import { CloseIcon, ExperimentsIcon } from "../../components/icons";
import { Page } from "../../components/Page";
import type {
  ExperimentGrid,
  ObservationImageCell,
  ObservationUnit,
} from "../../experiments/contracts";
import {
  observationUnitIsAvailableAt,
  observationUnitIsIncludedInAnalysis,
} from "../../experiments/culture-events";
import { designIssues } from "../../experiments/design";
import {
  experimentIdSchema,
  formatFactor,
  observationLabel,
  type ExperimentObservation,
  type Treatment,
} from "../../experiments/schema";
import {
  assignObservationUnitsToTreatment,
  getExperimentGrid,
} from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";
import {
  computeMetric,
  formatMetric,
  formatMetricSummary,
  summarizeMetric,
  type DerivedMetric,
  type Tally,
} from "../../models/metrics";
import { primaryMetric } from "../../models/schema";

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

type Dialog = "treatment" | "units" | "observation";

function ExperimentPage() {
  const {
    experiment,
    model,
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
  const [editing, setEditing] = useState<string | null>(null);
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
  const hasObservations = observations.length > 0;
  const hasRecords =
    images.length > 0 ||
    observationUnits.some(
      (observationUnit) => observationUnit.events.length > 0,
    );
  const unresolvedDesign = designIssues(treatments, observationUnits);
  const rows = experimentRows(treatments, observationUnits);
  const selected = pickedObservationUnits(selectedKeys, rows);
  const columns = useMemo(
    (): DataGridColumn<GridRow>[] => [
      {
        id: "treatment",
        header: "Treatment",
        isRowHeader: true,
        cell: (row) => {
          if (row.kind === "group") {
            return (
              <span className="truncate font-medium">
                {treatmentLabel(row.treatment)}
              </span>
            );
          }
          const observationUnit = row.unit;
          return (
            <span className="flex items-center gap-2 font-mono font-medium">
              <ObservationUnitTreatmentMenu
                experiment={experiment.id}
                observationUnit={observationUnit}
                treatments={treatments}
                onEdit={(treatment) => {
                  setEditing(treatment);
                  setOpen("treatment");
                }}
                onNew={() => {
                  setEditing(null);
                  setOpen("treatment");
                }}
              />
              <Link
                href={`/experiments/${experiment.id}/${observationUnit.id}`}
              >
                {observationUnit.code}
              </Link>
              <ObservationUnitMenu
                experiment={experiment.id}
                observationUnit={observationUnit}
                observations={observations}
                canRemove={
                  observationUnit.events.length === 0 &&
                  !images.some(
                    (image) => image.observationUnit === observationUnit.id,
                  )
                }
              />
            </span>
          );
        },
      },
      ...observations.map((observation): DataGridColumn<GridRow> => ({
        id: observation.id,
        align: "end",
        cellClassName: "font-mono tabular-nums",
        header: (
          <span className="inline-flex w-full items-center justify-end gap-1">
            <Hint text={observation.note || observation.observedOn}>
              <span>{observationLabel(observation)}</span>
            </Hint>
            <ObservationMenu
              experiment={experiment.id}
              observation={observation}
              observationUnits={observationUnits.filter((observationUnit) =>
                observationUnitIsAvailableAt(
                  observationUnit.events,
                  observation,
                  ordinals,
                ),
              )}
              assigned={assignedIn(images, observation.id)}
            />
          </span>
        ),
        cell: (row) =>
          row.kind === "group" ? (
            <span className="font-medium">
              {row.treatment
                ? groupSummary(
                    metric,
                    row.children,
                    observation,
                    cells,
                    ordinals,
                  )
                : "—"}
            </span>
          ) : (
            <Cell
              experiment={experiment.id}
              metric={metric}
              observationUnit={row.unit}
              image={cells.get(cellKey(row.unit.id, observation.id))}
              counted={observationUnitIsIncludedInAnalysis(
                row.unit.events,
                observation,
                ordinals,
              )}
            />
          ),
      })),
    ],
    [
      cells,
      experiment.id,
      images,
      metric,
      observationUnits,
      observations,
      ordinals,
      treatments,
    ],
  );

  return (
    <Page
      title={experiment.name}
      description={[
        experiment.plantMaterial,
        experiment.explantType,
        experiment.baseMedium,
      ]
        .filter(Boolean)
        .join(" · ")}
      actions={
        <>
          {hasObservations && model.metrics.length > 1 ? (
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
                      {item.name}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          ) : null}
          <Button variant="primary" onPress={() => setOpen("observation")}>
            New observation
          </Button>
          <ExperimentMenu
            experiment={experiment}
            images={images}
            datasets={datasets}
            hasRecords={hasRecords}
            onAddUnits={() => setOpen("units")}
          />
        </>
      }
    >
      {observationUnits.length === 0 && observations.length === 0 ? (
        <EmptyState size="sm">
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <ExperimentsIcon />
            </EmptyState.Media>
            <EmptyState.Title>No observation units yet</EmptyState.Title>
            <EmptyState.Description>
              Add observation units with existing codes, or a treatment they
              replicate.
            </EmptyState.Description>
          </EmptyState.Header>
          <EmptyState.Content>
            <Button variant="primary" onPress={() => setOpen("units")}>
              Add observation units
            </Button>
            <Button
              variant="tertiary"
              onPress={() => {
                setEditing(null);
                setOpen("treatment");
              }}
            >
              New treatment
            </Button>
          </EmptyState.Content>
        </EmptyState>
      ) : (
        <>
          {unresolvedDesign.length > 0 ? (
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{unresolvedDesign[0]}</Alert.Title>
                {unresolvedDesign.length > 1 ? (
                  <Alert.Description>
                    {unresolvedDesign.slice(1).join(" ")}
                  </Alert.Description>
                ) : null}
              </Alert.Content>
            </Alert>
          ) : null}
          <DataGrid
            showSelectionCheckboxes
            aria-label={`${metric.name} in ${experiment.name}`}
            columns={columns}
            data={rows}
            defaultExpandedKeys={rows.map((row) => row.id)}
            disabledKeys={rows.map((row) => row.id)}
            getChildren={(row) =>
              row.kind === "group" ? row.children : undefined
            }
            getRowId={(row) => row.id}
            selectedKeys={selectedKeys}
            selectionMode="multiple"
            treeColumn="treatment"
            onSelectionChange={setSelectedKeys}
          />
          <AssignmentBar
            experiment={experiment.id}
            treatments={treatments}
            selected={selected}
            onNew={() => {
              setEditing(null);
              setOpen("treatment");
            }}
            onDone={() => setSelectedKeys(new Set())}
          />
        </>
      )}

      <TreatmentDialog
        experiment={experiment.id}
        treatment={
          treatments.find((treatment) => treatment.id === editing) ?? null
        }
        isOpen={open === "treatment"}
        onClose={() => {
          setOpen(null);
          setEditing(null);
        }}
      />
      <AddObservationUnitsDialog
        experiment={experiment.id}
        treatments={treatments}
        isOpen={open === "units"}
        onClose={() => setOpen(null)}
      />
      <NewObservationDialog
        experiment={experiment.id}
        inoculatedOn={experiment.inoculatedOn}
        isOpen={open === "observation"}
        onClose={() => setOpen(null)}
      />
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

function AssignmentBar({
  experiment,
  treatments,
  selected,
  onNew,
  onDone,
}: {
  experiment: string;
  treatments: Treatment[];
  selected: string[];
  onNew: () => void;
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
        <Chip className="size-5 shrink-0 tabular-nums" size="sm">
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
                    data: {
                      experiment,
                      observationUnits: selected,
                      treatment,
                    },
                  }),
                "Observation units not assigned",
              ).then(async (result) => {
                if (!result.ok) return;
                onDone();
                await router.invalidate();
              });
            }}
            onNew={onNew}
          />
        </Dropdown>
      </ActionBar.Content>
      <Separator />
      <ActionBar.Suffix>
        <Tooltip delay={0}>
          <Tooltip.Trigger>
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
          </Tooltip.Trigger>
          <Tooltip.Content>Clear</Tooltip.Content>
        </Tooltip>
      </ActionBar.Suffix>
    </ActionBar>
  );
}

function cellKey(observationUnit: string, observation: string): string {
  return `${observation}\0${observationUnit}`;
}

function cellTally(
  image: ObservationImageCell | undefined,
  counted: boolean,
): Tally | null {
  if (!counted || !image) return null;
  return image.annotationTally ?? image.detectionTally;
}

type UnitRow = {
  kind: "unit";
  id: string;
  unit: ObservationUnit;
};

type GroupRow = {
  kind: "group";
  id: string;
  treatment: Treatment | null;
  children: UnitRow[];
};

type GridRow = GroupRow | UnitRow;

function treatmentLabel(treatment: Treatment | null): string {
  if (!treatment) return "No treatment";
  return [treatment.name, formatFactor(treatment.factor)]
    .filter(Boolean)
    .join(" · ");
}

function experimentRows(
  treatments: Treatment[],
  observationUnits: ObservationUnit[],
): GroupRow[] {
  const rows: GroupRow[] = [];
  for (const treatment of treatments) {
    const units = observationUnits.filter(
      (observationUnit) => observationUnit.treatment === treatment.id,
    );
    if (units.length === 0) continue;
    rows.push(groupRow(treatment, units));
  }
  const unassigned = observationUnits.filter(
    (observationUnit) => observationUnit.treatment === null,
  );
  if (unassigned.length > 0) {
    rows.push(groupRow(null, unassigned));
  }
  return rows;
}

function groupRow(
  treatment: Treatment | null,
  units: ObservationUnit[],
): GroupRow {
  return {
    kind: "group",
    id: treatment?.id ?? "unassigned",
    treatment,
    children: units.map((unit) => ({
      kind: "unit",
      id: unit.id,
      unit,
    })),
  };
}

function pickedObservationUnits(keys: Selection, rows: GroupRow[]): string[] {
  const units = rows.flatMap((row) => row.children.map((child) => child.id));
  if (keys === "all") return units;
  const selected = new Set([...keys].map(String));
  return units.filter((id) => selected.has(id));
}

function groupSummary(
  metric: DerivedMetric,
  units: UnitRow[],
  observation: ExperimentObservation,
  cells: Map<string, ObservationImageCell>,
  ordinals: Map<string, number>,
): string {
  return formatMetricSummary(
    metric,
    summarizeMetric(
      metric,
      units.flatMap((row) => {
        const counts = cellTally(
          cells.get(cellKey(row.unit.id, observation.id)),
          observationUnitIsIncludedInAnalysis(
            row.unit.events,
            observation,
            ordinals,
          ),
        );
        return counts ? [counts] : [];
      }),
    ),
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
  if (!image) return <span className="text-muted">—</span>;
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
      <Tooltip.Trigger>{control}</Tooltip.Trigger>
      <Tooltip.Content className="max-w-xs">{text}</Tooltip.Content>
    </Tooltip>
  );
}

import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import { Button, Link, ListBox, Select, Tooltip } from "@heroui/react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useState, type ReactElement } from "react";
import type { Selection } from "react-aria-components/Table";
import { z } from "zod";

import { ExperimentMenu } from "../../components/experiment/ExperimentMenu";
import { NewObservationDialog } from "../../components/experiment/NewObservationDialog";
import { ObservationMenu } from "../../components/experiment/ObservationMenu";
import { TreatmentDialog } from "../../components/experiment/TreatmentDialog";
import { TreatmentDot } from "../../components/experiment/TreatmentDot";
import { TreatmentMenu } from "../../components/experiment/TreatmentMenu";
import { UnitSelectionBar } from "../../components/experiment/UnitSelectionBar";
import { Hint } from "../../components/Hint";
import { Page } from "../../components/Page";
import type {
  ExperimentGrid,
  ObservationImageCell,
  Unit,
} from "../../experiments/contracts";
import {
  observationOrdinals,
  type ObservationOrdinals,
  unitIsAvailableAt,
  unitIsIncludedInAnalysis,
} from "../../experiments/culture-events";
import {
  experimentIdSchema,
  formatFactor,
  observationLabel,
  type ExperimentObservation,
  type Treatment,
} from "../../experiments/schema";
import { getExperimentGrid } from "../../functions/experiments";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";
import {
  computeMetric,
  formatMetric,
  formatMetricSummary,
  summarizeMetric,
  type DerivedMetric,
  type Tally,
} from "../../models/metrics";
import { metricName } from "../../models/names";
import { primaryMetric } from "../../models/schema";
import { m } from "../../paraglide/messages";

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
        { label: m.experiments_title(), href: "/experiments" },
        { label: experiment.name },
      ];
    },
  },
  head: ({ loaderData }) => {
    const { experiment } = loaderData as ExperimentGrid;
    return { meta: [{ title: `${experiment.name} · ${m.app_name()}` }] };
  },
  component: ExperimentPage,
});

type Dialog = { kind: "treatment" } | { kind: "observation" };

function ExperimentPage() {
  const {
    experiment,
    model,
    treatments,
    units,
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
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());
  const close = () => setOpen(null);

  const waiting = images.some((image) => image.state === "pending");
  useRouteRefresh(router, 5000, waiting);

  const cells = new Map(
    images.map((image) => [cellKey(image.unit, image.observation), image]),
  );
  const ordinals = observationOrdinals(observations);
  const hasRecords =
    images.length > 0 || units.some((unit) => unit.events.length > 0);
  const rows = experimentRows(treatments, units);
  const selected = selectedUnits(rows, selectedKeys);
  const columns: DataGridColumn<GridRow>[] = [
    {
      id: "design",
      header: m.experiment_column_treatment(),
      isRowHeader: true,
      cell: (row) =>
        row.kind === "treatment" ? (
          <span className="flex items-center gap-2">
            <TreatmentDot position={row.treatment.position} />
            <span className="truncate font-medium">{row.treatment.name}</span>
            {row.treatment.factor ? (
              <span className="truncate text-muted">
                {formatFactor(row.treatment.factor)}
              </span>
            ) : null}
          </span>
        ) : (
          <Link
            href={`/experiments/${experiment.id}/${row.unit.id}`}
            className="ps-6 font-mono font-medium"
          >
            {row.unit.code}
          </Link>
        ),
      minWidth: 200,
      pinned: "start",
    },
    ...observations.map((observation): DataGridColumn<GridRow> => ({
      id: observation.id,
      align: "end",
      cellClassName: "font-mono tabular-nums",
      minWidth: 140,
      header: (
        <span className="inline-flex w-full items-center justify-end gap-1">
          <Hint text={observation.note || observation.observedOn}>
            <span>{observationLabel(observation)}</span>
          </Hint>
          <ObservationMenu
            experiment={experiment.id}
            observation={observation}
            units={units.filter((unit) =>
              unitIsAvailableAt(unit.events, observation, ordinals),
            )}
            assigned={assignedIn(images, observation.id)}
          />
        </span>
      ),
      cell: (row) =>
        row.kind === "treatment" ? (
          <span className="font-medium">
            {groupSummary(metric, row.units, observation, cells, ordinals)}
          </span>
        ) : (
          <Cell
            experiment={experiment.id}
            metric={metric}
            unit={row.unit}
            image={cells.get(cellKey(row.unit.id, observation.id))}
            counted={unitIsIncludedInAnalysis(
              row.unit.events,
              observation,
              ordinals,
            )}
          />
        ),
    })),
    {
      align: "end",
      allowsResizing: false,
      cell: (row) =>
        row.kind === "treatment" ? (
          <TreatmentMenu
            experiment={experiment.id}
            treatment={row.treatment}
            deletable={treatments.length > 1}
          />
        ) : null,
      header: "",
      id: "actions",
      pinned: "end",
      width: 50,
    },
  ];

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
          {observations.length > 0 && model.metrics.length > 1 ? (
            <Select
              aria-label={m.experiment_metric_select()}
              className="w-44"
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
                      textValue={metricName(item)}
                    >
                      {metricName(item)}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          ) : null}
          <Button
            variant="primary"
            onPress={() => setOpen({ kind: "observation" })}
          >
            {m.observation_new()}
          </Button>
          <ExperimentMenu
            experiment={experiment}
            images={images}
            datasets={datasets}
            hasRecords={hasRecords}
            onNewTreatment={() => setOpen({ kind: "treatment" })}
          />
        </>
      }
    >
      <div className="pb-16">
        <DataGrid
          aria-label={m.experiment_grid_label({
            metric: metricName(metric),
            experiment: experiment.name,
          })}
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          selectionMode="multiple"
          showSelectionCheckboxes
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          disabledKeys={rows
            .filter((row) => row.kind === "treatment")
            .map((row) => row.id)}
        />
      </div>
      <UnitSelectionBar
        experiment={experiment.id}
        units={selected}
        treatments={treatments}
        observations={observations}
        onClear={() => setSelectedKeys(new Set())}
      />

      <TreatmentDialog
        experiment={experiment.id}
        treatment={null}
        isOpen={open?.kind === "treatment"}
        onClose={close}
      />
      <NewObservationDialog
        experiment={experiment.id}
        inoculatedOn={experiment.inoculatedOn}
        isOpen={open?.kind === "observation"}
        onClose={close}
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
      .map((image) => image.unit),
  );
}

function cellKey(unit: string, observation: string): string {
  return `${observation}\0${unit}`;
}

function cellTally(
  image: ObservationImageCell | undefined,
  counted: boolean,
): Tally | null {
  if (!counted || !image) return null;
  return image.annotationTally ?? image.detectionTally;
}

type GridRow =
  | { kind: "treatment"; id: string; treatment: Treatment; units: Unit[] }
  | { kind: "unit"; id: string; unit: Unit };

function selectedUnits(rows: GridRow[], keys: Selection): Unit[] {
  const units = rows.flatMap((row) => (row.kind === "unit" ? [row.unit] : []));
  if (keys === "all") return units;
  return units.filter((unit) => keys.has(unit.id));
}

/** The design as rows: each treatment, then the units that replicate it. */
function experimentRows(treatments: Treatment[], units: Unit[]): GridRow[] {
  return treatments.flatMap((treatment): GridRow[] => {
    const replicates = units.filter((unit) => unit.treatment === treatment.id);
    return [
      { kind: "treatment", id: treatment.id, treatment, units: replicates },
      ...replicates.map((unit): GridRow => ({
        kind: "unit",
        id: unit.id,
        unit,
      })),
    ];
  });
}

function groupSummary(
  metric: DerivedMetric,
  units: Unit[],
  observation: ExperimentObservation,
  cells: Map<string, ObservationImageCell>,
  ordinals: ObservationOrdinals,
): string {
  return formatMetricSummary(
    metric,
    summarizeMetric(
      metric,
      units.flatMap((unit) => {
        const counts = cellTally(
          cells.get(cellKey(unit.id, observation.id)),
          unitIsIncludedInAnalysis(unit.events, observation, ordinals),
        );
        return counts ? [counts] : [];
      }),
    ),
  );
}

function Cell({
  experiment,
  metric,
  unit,
  image,
  counted,
}: {
  experiment: string;
  metric: DerivedMetric;
  unit: Unit;
  image: ObservationImageCell | undefined;
  counted: boolean;
}) {
  if (!image) return <span className="text-muted">—</span>;
  const href = `/experiments/${experiment}/${unit.id}?observation=${image.observation}`;
  const value = (counts: Tally) =>
    formatMetric(metric, computeMetric(metric, counts));
  const dimmed = counted ? "" : "text-muted line-through";
  if (image.annotationTally) {
    return explain(
      [
        image.detectionTally
          ? m.experiment_cell_analyzed({ value: value(image.detectionTally) })
          : null,
        counted ? null : m.experiment_cell_excluded(),
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
      counted ? null : m.experiment_cell_excluded(),
      <Link href={href} className={dimmed}>
        {value(image.detectionTally)}
      </Link>,
    );
  }
  if (image.state === "failed") {
    return explain(
      image.error,
      <Link href={href} className="text-danger">
        {m.image_analysis_failed()}
      </Link>,
    );
  }
  return (
    <Link href={href} className="text-muted">
      {m.image_analysis_pending()}
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

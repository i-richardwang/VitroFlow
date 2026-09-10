import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import { Button, Link, Tooltip } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState, type ReactElement } from "react";
import type { Selection } from "react-aria-components/Table";

import { ExperimentMenu } from "./ExperimentMenu";
import { ObservationDialog } from "./ObservationDialog";
import { ObservationMenu } from "./ObservationMenu";
import { TreatmentDialog } from "./TreatmentDialog";
import { TreatmentDot } from "./TreatmentDot";
import { TreatmentMenu } from "./TreatmentMenu";
import { UnitSelectionBar } from "./UnitSelectionBar";
import { Page } from "../../ui/Page";
import type {
  ObservationImageCell,
  Unit,
} from "../../domain/experiments/contracts";
import {
  observationOrdinals,
  type ObservationOrdinals,
  unitIsAvailableAt,
  unitIsIncludedInAnalysis,
} from "../../domain/experiments/culture-events";
import {
  formatFactor,
  type ExperimentObservation,
  type Treatment,
} from "../../domain/experiments/schema";
import { observationLabel } from "./labels";
import type { Model } from "../../domain/models/schema";
import type { getExperimentGrid } from "../../functions/experiments";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import {
  cellKey,
  experimentReadings,
  summarize,
  type ExperimentReadings,
} from "../../domain/experiments/readings";
import { modelName } from "../../ui/model-names";
import {
  formatCount,
  formatCountSummary,
  formatRate,
  formatRateSummary,
} from "../../ui/readings";
import { m } from "../../paraglide/messages";

type Dialog = { kind: "treatment" } | { kind: "observation" };

export function ExperimentGridView({
  data,
}: {
  data: NonNullable<Awaited<ReturnType<typeof getExperimentGrid>>>;
}) {
  const {
    experiment,
    treatments,
    units,
    observations,
    images,
    models,
    datasets,
  } = data;
  const router = useRouter();
  const [open, setOpen] = useState<Dialog | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());
  const close = () => setOpen(null);

  const waiting = images.some((image) => image.state === "pending");
  useRouteRefresh(router, 5000, waiting);

  const cells = new Map(
    images.map((image) => [cellKey(image.unit, image.observation), image]),
  );
  const ordinals = observationOrdinals(observations);
  const readings = experimentReadings(observations, cells);
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
    ...observations.map((observation): DataGridColumn<GridRow> => {
      return {
        id: observation.id,
        align: "end",
        cellClassName: "font-mono tabular-nums",
        minWidth: 160,
        header: (
          <ObservationMenu
            experiment={experiment.id}
            inoculatedOn={experiment.inoculatedOn}
            observation={observation}
            label={observationHeading(observation, observations, models)}
            units={units.filter((unit) =>
              unitIsAvailableAt(unit.events, observation, ordinals),
            )}
            images={images.filter(
              (image) => image.observation === observation.id,
            )}
            models={models}
            datasets={datasets
              .filter((dataset) => dataset.modelId === observation.modelId)
              .map((dataset) => dataset.id)}
          />
        ),
        cell: (row) =>
          row.kind === "treatment" ? (
            <span className="font-medium">
              {groupSummary(readings, row.units, observation, ordinals)}
            </span>
          ) : (
            <Cell
              experiment={experiment.id}
              readings={readings}
              observation={observation}
              unit={row.unit}
              image={cells.get(cellKey(row.unit.id, observation.id))}
              counted={unitIsIncludedInAnalysis(
                row.unit.events,
                observation,
                ordinals,
              )}
            />
          ),
      };
    }),
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
          <Button
            variant="primary"
            onPress={() => setOpen({ kind: "observation" })}
          >
            {m.observation_new()}
          </Button>
          <ExperimentMenu
            experiment={experiment}
            hasRecords={hasRecords}
            onNewTreatment={() => setOpen({ kind: "treatment" })}
          />
        </>
      }
    >
      <div className="pb-16">
        <DataGrid
          aria-label={m.experiment_grid_label({ experiment: experiment.name })}
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          selectionMode="multiple"
          showSelectionCheckboxes
          selectedKeys={selectedKeys}
          onSelectionChange={(keys) =>
            setSelectedKeys((previous) => selectUnits(rows, previous, keys))
          }
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
      <ObservationDialog
        experiment={experiment.id}
        inoculatedOn={experiment.inoculatedOn}
        models={models}
        observation={null}
        previous={observations.at(-1)}
        isOpen={open?.kind === "observation"}
        onClose={close}
      />
    </Page>
  );
}

/**
 * The column is the day, and the model only when days do not all read with the
 * same one. The version is how the day is read, not what the grid names.
 */
function observationHeading(
  observation: ExperimentObservation,
  observations: readonly ExperimentObservation[],
  models: readonly Model[],
): string {
  const day = observationLabel(observation);
  const modelOf = (item: ExperimentObservation) =>
    models.find((model) => model.id === item.modelId);
  const model = modelOf(observation);
  const first = modelOf(observations[0]!);
  if (!model || observations.every((item) => modelOf(item)?.id === first?.id)) {
    return day;
  }
  return `${day} · ${modelName(model)}`;
}

type GridRow =
  | { kind: "treatment"; id: string; treatment: Treatment; units: Unit[] }
  | { kind: "unit"; id: string; unit: Unit };

function selectedUnits(rows: GridRow[], keys: Selection): Unit[] {
  const units = rows.flatMap((row) => (row.kind === "unit" ? [row.unit] : []));
  if (keys === "all") return units;
  return units.filter((unit) => keys.has(unit.id));
}

function rowIds(selection: Selection, rows: GridRow[]): Set<string> {
  if (selection === "all") return new Set(rows.map((row) => row.id));
  return new Set([...selection].map(String));
}

/** Treatment checkboxes select or clear that treatment's replicates. */
function selectUnits(
  rows: GridRow[],
  previous: Selection,
  incoming: Selection,
): Selection {
  if (incoming === "all") return "all";
  const before = rowIds(previous, rows);
  const next = rowIds(incoming, rows);
  for (const row of rows) {
    if (row.kind !== "treatment") continue;
    const on = next.has(row.id);
    const was = before.has(row.id);
    if (on && !was) {
      for (const unit of row.units) next.add(unit.id);
    } else if (!on && was) {
      for (const unit of row.units) next.delete(unit.id);
    }
  }
  for (const row of rows) {
    if (row.kind !== "treatment") continue;
    next.delete(row.id);
    if (row.units.length > 0 && row.units.every((unit) => next.has(unit.id))) {
      next.add(row.id);
    }
  }
  return rows.every((row) => next.has(row.id)) ? "all" : next;
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

/**
 * The replicates of one treatment on one day. Shares are what treatments are
 * compared by, so a day that reads them summarizes them; a day without them,
 * the baseline among others, summarizes its counts.
 */
function groupSummary(
  readings: ExperimentReadings,
  units: Unit[],
  observation: ExperimentObservation,
  ordinals: ObservationOrdinals,
): string {
  const counted = units.flatMap((unit) => {
    if (!unitIsIncludedInAnalysis(unit.events, observation, ordinals))
      return [];
    const reading = readings.read(unit.id, observation);
    return reading ? [reading] : [];
  });
  const rates = counted.map((reading) => reading.rate);
  if (rates.length > 0 && rates.every((rate) => rate !== null)) {
    return formatRateSummary(summarize(rates));
  }
  return formatCountSummary(summarize(counted.map((item) => item.count)));
}

function Cell({
  experiment,
  readings,
  observation,
  unit,
  image,
  counted,
}: {
  experiment: string;
  readings: ExperimentReadings;
  observation: ExperimentObservation;
  unit: Unit;
  image: ObservationImageCell | undefined;
  counted: boolean;
}) {
  if (!image) return <span className="text-muted">—</span>;
  const href = `/experiments/${experiment}/${unit.id}?observation=${image.observation}`;
  const dimmed = counted ? "" : "text-muted line-through";
  const reading = readings.read(unit.id, observation);
  if (reading) {
    return explain(
      [
        reading.detected === null
          ? null
          : m.experiment_cell_analyzed({
              value: formatCount(reading.detected),
            }),
        counted ? null : m.experiment_cell_excluded(),
      ]
        .filter(Boolean)
        .join(" · "),
      <Link
        href={href}
        className={`${reading.calibrated ? "font-semibold" : ""} ${dimmed}`}
      >
        {formatCount(reading.count)}
        {reading.rate === null ? null : (
          <span className="font-normal text-muted">
            {" · "}
            {formatRate(reading.rate)}
          </span>
        )}
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
      {image.state === "unread"
        ? m.image_analysis_unread()
        : m.image_analysis_pending()}
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

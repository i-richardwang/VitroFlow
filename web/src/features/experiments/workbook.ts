import { parseDate } from "@internationalized/date";

import {
  blankCell,
  countCell,
  dateCell,
  rateCell,
  sheetName,
  textCell,
  workbookFilename,
  type CellStyle,
  type Workbook,
  type WorkbookCell,
} from "../../lib/spreadsheet/workbook";
import type { ExperimentGrid, Unit } from "../../domain/experiments/contracts";
import {
  exclusionAt,
  observationOrdinals,
  type ObservationOrdinals,
} from "../../domain/experiments/culture-events";
import {
  cellKey,
  experimentReadings,
  summarize,
  type ExperimentReadings,
} from "../../domain/experiments/readings";
import {
  formatFactor,
  type CalendarDay,
  type Experiment,
  type ExperimentObservation,
  type Treatment,
} from "../../domain/experiments/schema";
import type { Model } from "../../domain/models/schema";
import { cultureEventLabel, observationLabel } from "./labels";
import { modelName } from "../../ui/model-names";
import { m } from "../../paraglide/messages";

/** The grid, and the models its days were read for. */
export type ExperimentWorkbookSource = ExperimentGrid & {
  models: readonly Model[];
};

/** A quantity a day is read for, and which occupies a column under it. */
type Quantity = "count" | "rate" | "replicates";

/**
 * Every day is read for a tally, and for the replicates a mean of it is over.
 * A day is read for a share as well once an earlier day has established the
 * population that share is of.
 */
const QUANTITIES: readonly Quantity[] = ["count", "rate", "replicates"];
const BASELINE_QUANTITIES: readonly Quantity[] = ["count", "replicates"];

const QUANTITY_WIDTH: Record<Quantity, number> = {
  count: 10,
  rate: 10,
  replicates: 8,
};

function quantityLabel(quantity: Quantity): string {
  switch (quantity) {
    case "count":
      return m.workbook_quantity_count();
    case "rate":
      return m.workbook_quantity_rate();
    case "replicates":
      return m.workbook_quantity_replicates();
  }
}

/** A day across the top, and the columns it occupies underneath. */
interface Day {
  observation: ExperimentObservation;
  model: Model | null;
  quantities: readonly Quantity[];
}

/** The design names every row, so the table sorts and pivots on it. */
const DESIGN_COLUMNS = [{ width: 22 }, { width: 16 }, { width: 14 }];
const HEADING_ROWS = 3;

export function experimentWorkbookFilename(experiment: Experiment): string {
  return workbookFilename(experiment.name, m.experiments_title());
}

/**
 * The grid as a spreadsheet: the design repeated down every row, the days
 * across the top, and every quantity left as a number for whatever charts or
 * computes on it. A day that establishes the population reads counts alone,
 * as the grid does.
 *
 * The sheet records what the dish did rather than what the workbench is doing.
 * A reading still waiting, or one that failed, leaves its cell empty; a unit an
 * event took out of the analysis is named by that event, in place of a number
 * nobody should average.
 *
 * A treatment states the replicates its mean is over, which exclusions move
 * day by day. One dish is not a sample, so a unit leaves that column to the
 * treatment above it.
 */
export function experimentWorkbook(
  source: ExperimentWorkbookSource,
  exportedOn: CalendarDay,
): Workbook {
  const { experiment, treatments, units, observations, images, models } =
    source;
  const cells = new Map(
    images.map((image) => [cellKey(image.unit, image.observation), image]),
  );
  const ordinals = observationOrdinals(observations);
  const readings = experimentReadings(observations, cells);
  const days = observations.map((observation): Day => ({
    observation,
    model: models.find((model) => model.id === observation.modelId) ?? null,
    quantities:
      observation.id === readings.baseline?.id
        ? BASELINE_QUANTITIES
        : QUANTITIES,
  }));

  const rows: WorkbookCell[][] = [
    [textCell(experiment.name, { strong: true })],
    ...provenance(experiment, exportedOn),
    [],
  ];
  const stickyRows = rows.length + HEADING_ROWS;
  rows.push(...heading(days));
  for (const treatment of treatments) {
    const replicates = units.filter((unit) => unit.treatment === treatment.id);
    rows.push(meanRow(treatment, replicates, days, readings, ordinals));
    for (const unit of replicates) {
      rows.push(unitRow(treatment, unit, days, readings, ordinals));
    }
  }

  return {
    sheet: sheetName(experiment.name, m.experiments_title()),
    columns: [
      ...DESIGN_COLUMNS,
      ...days.flatMap((day) =>
        day.quantities.map((quantity) => ({ width: QUANTITY_WIDTH[quantity] })),
      ),
    ],
    rows,
    stickyRows,
    stickyColumns: DESIGN_COLUMNS.length,
  };
}

/** A calendar day, as the day a spreadsheet counts rather than the text of it. */
function calendarCell(day: CalendarDay, style: CellStyle = {}): WorkbookCell {
  return dateCell(parseDate(day), style);
}

/** A field left unfilled has nothing to say. */
function fieldCell(value: string): WorkbookCell {
  return value.length > 0 ? textCell(value) : blankCell;
}

/** Which experiment this is, and when the numbers were taken from it. */
function provenance(
  experiment: Experiment,
  exportedOn: CalendarDay,
): WorkbookCell[][] {
  const fields: [label: string, value: WorkbookCell][] = [
    [m.experiment_field_plant_material(), fieldCell(experiment.plantMaterial)],
    [m.experiment_field_explant_type(), fieldCell(experiment.explantType)],
    [m.experiment_field_base_medium(), fieldCell(experiment.baseMedium)],
    [m.experiment_field_inoculated(), calendarCell(experiment.inoculatedOn)],
    [m.workbook_exported(), calendarCell(exportedOn)],
  ];
  return fields
    .filter(([, value]) => value.kind !== "blank")
    .map(([label, value]) => [textCell(label, { strong: true }), value]);
}

/** The day, the date it was made, and the quantities read under it. */
function heading(days: readonly Day[]): WorkbookCell[][] {
  const covering = { strong: true, rows: HEADING_ROWS };
  const names: WorkbookCell[] = [
    textCell(m.experiment_column_treatment(), covering),
    textCell(m.workbook_column_factor(), covering),
    textCell(m.workbook_column_unit(), covering),
  ];
  const dates: WorkbookCell[] = DESIGN_COLUMNS.map(() => blankCell);
  const quantities: WorkbookCell[] = DESIGN_COLUMNS.map(() => blankCell);
  for (const day of days) {
    const columns = day.quantities.length;
    const covered = day.quantities.slice(1).map(() => blankCell);
    names.push(
      textCell(dayHeading(day), { strong: true, columns }),
      ...covered,
    );
    dates.push(
      calendarCell(day.observation.observedOn, { columns }),
      ...covered,
    );
    quantities.push(
      ...day.quantities.map((quantity) =>
        textCell(quantityLabel(quantity), { strong: true }),
      ),
    );
  }
  return [names, dates, quantities];
}

/** A file outlives its workbench, so a day names the model it was read for. */
function dayHeading(day: Day): string {
  const label = observationLabel(day.observation);
  return day.model ? `${label} · ${modelName(day.model)}` : label;
}

/** The level this treatment sets, for the rows to be grouped and filtered by. */
function factorCell(treatment: Treatment, style: CellStyle = {}): WorkbookCell {
  return treatment.factor
    ? textCell(formatFactor(treatment.factor), style)
    : blankCell;
}

/** The cells a day holds, taken in the order the day is read for them. */
function dayCells(
  day: Day,
  read: Record<Quantity, WorkbookCell>,
): WorkbookCell[] {
  return day.quantities.map((quantity) => read[quantity]);
}

function unitRow(
  treatment: Treatment,
  unit: Unit,
  days: readonly Day[],
  readings: ExperimentReadings,
  ordinals: ObservationOrdinals,
): WorkbookCell[] {
  return [
    textCell(treatment.name),
    factorCell(treatment),
    textCell(unit.code),
    ...days.flatMap((day) => unitCells(unit, day, readings, ordinals)),
  ];
}

function unitCells(
  unit: Unit,
  day: Day,
  readings: ExperimentReadings,
  ordinals: ObservationOrdinals,
): WorkbookCell[] {
  const excluded = exclusionAt(unit.events, day.observation, ordinals);
  if (excluded) {
    return dayCells(day, {
      count: textCell(cultureEventLabel(excluded.type)),
      rate: blankCell,
      replicates: blankCell,
    });
  }
  const reading = readings.read(unit.id, day.observation);
  if (!reading) {
    return dayCells(day, {
      count: blankCell,
      rate: blankCell,
      replicates: blankCell,
    });
  }
  return dayCells(day, {
    count: countCell(reading.count),
    rate: reading.rate === null ? blankCell : rateCell(reading.rate),
    replicates: blankCell,
  });
}

function meanRow(
  treatment: Treatment,
  replicates: readonly Unit[],
  days: readonly Day[],
  readings: ExperimentReadings,
  ordinals: ObservationOrdinals,
): WorkbookCell[] {
  const strong = { strong: true };
  return [
    textCell(treatment.name, strong),
    factorCell(treatment, strong),
    textCell(m.workbook_row_mean(), strong),
    ...days.flatMap((day) => meanCells(replicates, day, readings, ordinals)),
  ];
}

/**
 * The treatment on one day, over the replicates the analysis still counts.
 * Shares average only when every one of those replicates has one, as on the
 * grid: a mean over some of them would divide by a population it never states.
 */
function meanCells(
  replicates: readonly Unit[],
  day: Day,
  readings: ExperimentReadings,
  ordinals: ObservationOrdinals,
): WorkbookCell[] {
  const counted = replicates.flatMap((unit) => {
    if (exclusionAt(unit.events, day.observation, ordinals)) return [];
    const reading = readings.read(unit.id, day.observation);
    return reading ? [reading] : [];
  });
  const tally = summarize(counted.map((reading) => reading.count));
  const shares = counted.flatMap((reading) =>
    reading.rate === null ? [] : [reading.rate],
  );
  const share =
    shares.length === counted.length ? summarize(shares).value : null;
  return dayCells(day, {
    count: tally.value === null ? blankCell : countCell(tally.value),
    rate: share === null ? blankCell : rateCell(share),
    replicates: countCell(tally.sampleSize),
  });
}

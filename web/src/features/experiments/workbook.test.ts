import { describe, expect, test } from "bun:test";

import type {
  ObservationImageCell,
  Unit,
} from "../../domain/experiments/contracts";
import type {
  Experiment,
  ExperimentObservation,
  Treatment,
} from "../../domain/experiments/schema";
import type { Model } from "../../domain/models/schema";
import type { WorkbookCell } from "../../lib/spreadsheet/workbook";
import {
  experimentWorkbook,
  experimentWorkbookFilename,
  type ExperimentWorkbookSource,
} from "./workbook";

/** The day, its date, and the quantities under it. */
const HEADING_ROWS = 3;

const SEEDS: Model = {
  schemaVersion: 1,
  id: "seed-detector",
  name: "Seed detector",
  task: "object_detection",
  classes: ["seed"],
};

const SHOOTS: Model = {
  schemaVersion: 1,
  id: "germination",
  name: "Germination",
  task: "object_detection",
  classes: ["germinated"],
};

const EXPERIMENT: Experiment = {
  id: "experiment",
  name: "Germination trial",
  plantMaterial: "Chrysanthemum 'Jinba'",
  explantType: "",
  baseMedium: "MS",
  notes: "",
  inoculatedOn: "2026-09-01",
  createdAt: "2026-09-01T00:00:00.000Z",
};

const SOWN: ExperimentObservation = {
  id: "sown",
  ordinal: 1,
  observedOn: "2026-09-01",
  day: 0,
  note: "",
  modelId: SEEDS.id,
  hasRecords: true,
};

const GERMINATED: ExperimentObservation = {
  id: "germinated",
  ordinal: 2,
  observedOn: "2026-09-15",
  day: 14,
  note: "",
  modelId: SHOOTS.id,
  hasRecords: true,
};

const TREATMENT: Treatment = {
  id: "control",
  name: "CK",
  factor: { name: "BA", level: "0", unit: "mg/L" },
  note: "",
  position: 1,
};

const CONTAMINATED: Unit["events"] = [
  {
    id: "event",
    type: "contaminated",
    observation: GERMINATED.id,
    recordedAt: "2026-09-15T00:00:00.000Z",
  },
];

function unit(code: string, events: Unit["events"] = []): Unit {
  return { id: code, code, treatment: TREATMENT.id, events };
}

function image(
  unitId: string,
  observation: string,
  tally: Record<string, number>,
): ObservationImageCell {
  return {
    id: `${unitId}-${observation}`,
    unit: unitId,
    observation,
    digest: "a".repeat(64),
    filename: `${unitId}.JPG`,
    state: "analyzed",
    detectionTally: tally,
    annotationTally: null,
    error: null,
  };
}

/** Two replicates sown with twenty seeds, of which fifteen and ten germinated. */
function trial(overrides: Partial<ExperimentWorkbookSource> = {}) {
  return experimentWorkbook(
    {
      experiment: EXPERIMENT,
      treatments: [TREATMENT],
      units: [unit("A1"), unit("A2")],
      observations: [SOWN, GERMINATED],
      images: [
        image("A1", SOWN.id, { seed: 20 }),
        image("A2", SOWN.id, { seed: 20 }),
        image("A1", GERMINATED.id, { germinated: 15 }),
        image("A2", GERMINATED.id, { germinated: 10 }),
      ],
      models: [SEEDS, SHOOTS],
      ...overrides,
    },
    "2026-09-20",
  );
}

/** The block that says which experiment this is, above the heading. */
function describes(workbook: ReturnType<typeof trial>): WorkbookCell[][] {
  return workbook.rows.slice(0, workbook.stickyRows - HEADING_ROWS);
}

/** The day, its date, and the quantities read under it. */
function heading(workbook: ReturnType<typeof trial>): WorkbookCell[][] {
  return workbook.rows.slice(
    workbook.stickyRows - HEADING_ROWS,
    workbook.stickyRows,
  );
}

/** The rows below the heading, which is where the readings begin. */
function readings(workbook: ReturnType<typeof trial>): WorkbookCell[][] {
  return workbook.rows.slice(workbook.stickyRows);
}

describe("the experiment workbook", () => {
  test("says which experiment it is and when it was taken", () => {
    expect(describes(trial())).toEqual([
      [{ kind: "text", text: "Germination trial", strong: true }],
      [
        { kind: "text", text: "Plant material", strong: true },
        { kind: "text", text: "Chrysanthemum 'Jinba'" },
      ],
      [
        { kind: "text", text: "Base medium", strong: true },
        { kind: "text", text: "MS" },
      ],
      [
        { kind: "text", text: "Inoculated", strong: true },
        { kind: "date", date: new Date(Date.UTC(2026, 8, 1)) },
      ],
      [
        { kind: "text", text: "Exported", strong: true },
        { kind: "date", date: new Date(Date.UTC(2026, 8, 20)) },
      ],
      [],
    ]);
  });

  test("names the model of every day, and dates it underneath", () => {
    const [names, dates, quantities] = heading(trial());
    expect(names?.slice(3)).toEqual([
      { kind: "text", text: "Day 0 · Seed detector", strong: true, columns: 2 },
      { kind: "blank" },
      { kind: "text", text: "Day 14 · Germination", strong: true, columns: 3 },
      { kind: "blank" },
      { kind: "blank" },
    ]);
    expect(dates?.slice(3)).toEqual([
      { kind: "date", date: new Date(Date.UTC(2026, 8, 1)), columns: 2 },
      { kind: "blank" },
      { kind: "date", date: new Date(Date.UTC(2026, 8, 15)), columns: 3 },
      { kind: "blank" },
      { kind: "blank" },
    ]);
    expect(
      quantities?.slice(3).map((cell) => cell.kind === "text" && cell.text),
    ).toEqual(["Count", "Replicates", "Count", "Rate", "Replicates"]);
  });

  test("the day that establishes the population reads counts alone", () => {
    const workbook = trial();
    expect(workbook.columns).toHaveLength(8);
    expect(workbook.stickyColumns).toBe(3);
  });

  test("a unit reads its own tallies, and a share as the fraction it is", () => {
    const [, first] = readings(trial());
    expect(first).toEqual([
      { kind: "text", text: "CK" },
      { kind: "text", text: "BA 0 mg/L" },
      { kind: "text", text: "A1" },
      { kind: "count", count: 20 },
      { kind: "blank" },
      { kind: "count", count: 15 },
      { kind: "rate", rate: 0.75 },
      { kind: "blank" },
    ]);
  });

  test("the treatment means its replicates, and states how many", () => {
    const [summary] = readings(trial());
    expect(summary?.slice(2)).toEqual([
      { kind: "text", text: "Mean", strong: true },
      { kind: "count", count: 20 },
      { kind: "count", count: 2 },
      { kind: "count", count: 12.5 },
      { kind: "rate", rate: 0.625 },
      { kind: "count", count: 2 },
    ]);
  });

  test("an excluded unit is named by the event, and left out of the mean", () => {
    const workbook = trial({
      units: [unit("A1"), unit("A2", CONTAMINATED)],
    });
    const [summary, , second] = readings(workbook);
    expect(second?.slice(5)).toEqual([
      { kind: "text", text: "Contaminated" },
      { kind: "blank" },
      { kind: "blank" },
    ]);
    expect(summary?.slice(5)).toEqual([
      { kind: "count", count: 15 },
      { kind: "rate", rate: 0.75 },
      { kind: "count", count: 1 },
    ]);
  });

  test("a reading still to come leaves its cell empty, and its mean over none", () => {
    const workbook = trial({
      images: [
        image("A1", SOWN.id, { seed: 20 }),
        image("A2", SOWN.id, { seed: 20 }),
      ],
    });
    const [summary, first] = readings(workbook);
    expect(first?.slice(5)).toEqual([
      { kind: "blank" },
      { kind: "blank" },
      { kind: "blank" },
    ]);
    expect(summary?.slice(5)).toEqual([
      { kind: "blank" },
      { kind: "blank" },
      { kind: "count", count: 0 },
    ]);
  });
});

describe("what the file is called", () => {
  test("is named for the experiment", () => {
    expect(experimentWorkbookFilename(EXPERIMENT)).toBe(
      "Germination trial.xlsx",
    );
  });

  test("falls back to what the page is called", () => {
    expect(experimentWorkbookFilename({ ...EXPERIMENT, name: "//" })).toBe(
      "Experiments.xlsx",
    );
  });
});

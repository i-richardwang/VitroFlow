import { describe, expect, test } from "bun:test";

import { dateCell, sheetName, workbookFilename } from "./workbook";

describe("a day in a cell", () => {
  test("is the day itself, at the hour no timezone can move it from", () => {
    const cell = dateCell({ year: 2026, month: 9, day: 1 });
    expect(cell).toEqual({
      kind: "date",
      date: new Date(Date.UTC(2026, 8, 1)),
    });
    expect(cell.kind === "date" && cell.date.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });

  test("carries the style it is set in", () => {
    expect(dateCell({ year: 2026, month: 9, day: 1 }, { columns: 3 })).toEqual({
      kind: "date",
      date: new Date(Date.UTC(2026, 8, 1)),
      columns: 3,
    });
  });
});

describe("naming a sheet", () => {
  test("keeps a name a spreadsheet can hold", () => {
    expect(sheetName("Germination trial", "Experiments")).toBe(
      "Germination trial",
    );
  });

  test("spells out the punctuation a range reference is written with", () => {
    expect(sheetName("MS/B5:2026 [rep*1]", "Experiments")).toBe(
      "MS B5 2026 rep 1",
    );
  });

  test("stops at thirty-one characters, and not on a space", () => {
    expect(sheetName(`${"A".repeat(30)} trial`, "Experiments")).toBe(
      "A".repeat(30),
    );
  });

  test("does not open or close on the quote that would make it a reference", () => {
    expect(sheetName("'Jinba'", "Experiments")).toBe("Jinba");
  });

  test("falls back when nothing writable is left", () => {
    expect(sheetName("///", "Experiments")).toBe("Experiments");
    expect(sheetName("   ", "Experiments")).toBe("Experiments");
  });
});

describe("naming a file", () => {
  test("keeps a name a file system will take", () => {
    expect(workbookFilename("Germination trial", "Experiments")).toBe(
      "Germination trial.xlsx",
    );
  });

  test("will not be read as a path", () => {
    expect(workbookFilename('MS/B5 "2026" <1>', "Experiments")).toBe(
      "MS B5 2026 1.xlsx",
    );
  });

  test("falls back when nothing writable is left", () => {
    expect(workbookFilename("//", "Experiments")).toBe("Experiments.xlsx");
  });
});

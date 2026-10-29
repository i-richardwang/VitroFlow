import { describe, expect, test } from "bun:test";

import type { ObservationImageCell } from "./contracts";
import type { ExperimentObservation } from "./schema";
import { UnknownClassError } from "../models/errors";
import {
  countChange,
  imageReading,
  observationCells,
  readingIsTrusted,
  resolveCountedClasses,
  unitReading,
} from "./readings";

function cell(
  unit: string,
  observation: string,
  overrides: Partial<ObservationImageCell> = {},
): ObservationImageCell {
  return {
    id: `${unit}-${observation}`,
    unit,
    observation,
    digest: "a".repeat(64),
    filename: "IMG_0001.JPG",
    state: "analyzed",
    detectionTally: null,
    proposalTally: null,
    annotationTally: null,
    error: null,
    unclear: false,
    ...overrides,
  };
}

const SEED_CLASSES = ["ungerminated", "germinated"];

function observation(
  ordinal: number,
  counted: string[] = SEED_CLASSES,
  modelId = "seed-detector",
): ExperimentObservation {
  return {
    id: `observation-${ordinal}`,
    ordinal,
    observedOn: "2026-09-01",
    note: "",
    modelId,
    countedClasses: counted,
    hasRecords: false,
  };
}

/** What a reading looks like when nobody has reviewed the detection behind it. */
const unreviewed = (count: number) => ({
  count,
  source: "detection" as const,
});

describe("what a grid reads", () => {
  const day0 = observation(1);

  test("a day that names every class counts the whole tally", () => {
    const cells = observationCells([
      cell("dish", day0.id, {
        detectionTally: { ungerminated: 12, germinated: 8 },
      }),
    ]);
    expect(unitReading(cells, "dish", day0)).toEqual(unreviewed(20));
  });

  test("a later day counts only the classes it names", () => {
    const day7 = observation(2, ["germinated"]);
    const cells = observationCells([
      cell("dish", day7.id, {
        annotationTally: { ungerminated: 3, germinated: 15 },
      }),
    ]);
    expect(unitReading(cells, "dish", day7)).toEqual({
      count: 15,
      source: "review",
    });
  });

  test("a review replaces the AI's suggestion and the detection under it", () => {
    const cells = observationCells([
      cell("dish", day0.id, {
        detectionTally: { ungerminated: 19 },
        proposalTally: { ungerminated: 21 },
        annotationTally: { ungerminated: 20 },
      }),
    ]);
    expect(unitReading(cells, "dish", day0)).toEqual({
      count: 20,
      source: "review",
    });
  });

  test("an AI suggestion reads before the detection", () => {
    const cells = observationCells([
      cell("dish", day0.id, {
        detectionTally: { ungerminated: 19 },
        proposalTally: { ungerminated: 21 },
      }),
    ]);
    expect(unitReading(cells, "dish", day0)).toEqual({
      count: 21,
      source: "proposal",
    });
  });

  test("a photograph not yet counted, or none, reads nothing", () => {
    const cells = observationCells([cell("dish", day0.id)]);
    expect(unitReading(cells, "dish", day0)).toBeNull();
    expect(unitReading(cells, "other", day0)).toBeNull();
  });
});

describe("what a day's photograph reads", () => {
  test("the classes its day counts, from the best reading it has", () => {
    const day7 = observation(2, ["germinated"]);
    const image = cell("dish", day7.id, {
      detectionTally: { ungerminated: 4, germinated: 9 },
      proposalTally: { ungerminated: 3, germinated: 11 },
    });
    expect(imageReading(image, day7)).toEqual({
      count: 11,
      source: "proposal",
    });
  });

  test("nothing without a photograph or a reading of it", () => {
    expect(imageReading(null, observation(1))).toBeNull();
    const unread = cell("dish", "observation-1");
    expect(imageReading(unread, observation(1))).toBeNull();
  });
});

describe("how a unit's count changed between two days", () => {
  const day0 = observation(1, ["germinated"]);
  const day7 = observation(2, ["germinated"]);
  const before = cell("dish", day0.id, {
    annotationTally: { ungerminated: 20, germinated: 2 },
  });
  const after = cell("dish", day7.id, {
    detectionTally: { ungerminated: 6, germinated: 15 },
  });
  const rule = { countsUnclear: false };

  test("the later count less the earlier, whoever read each", () => {
    expect(
      countChange(
        { observation: day0, image: before },
        { observation: day7, image: after },
        rule,
      ),
    ).toBe(13);
    expect(
      countChange(
        { observation: day7, image: after },
        { observation: day0, image: before },
        rule,
      ),
    ).toBe(-13);
  });

  test("nothing when the days count different classes", () => {
    expect(
      countChange(
        { observation: observation(1), image: before },
        { observation: day7, image: after },
        rule,
      ),
    ).toBeNull();
  });

  test("nothing when the days read with different models", () => {
    expect(
      countChange(
        { observation: day0, image: before },
        {
          observation: observation(2, ["germinated"], "shoot-detector"),
          image: after,
        },
        rule,
      ),
    ).toBeNull();
  });

  test("nothing while either day has no reading", () => {
    expect(
      countChange(
        { observation: day0, image: null },
        { observation: day7, image: after },
        rule,
      ),
    ).toBeNull();
  });

  test("nothing from an unclear photograph, unless the experiment counts it", () => {
    const fogged = { ...before, unclear: true };
    expect(
      countChange(
        { observation: day0, image: fogged },
        { observation: day7, image: after },
        rule,
      ),
    ).toBeNull();
    expect(
      countChange(
        { observation: day0, image: fogged },
        { observation: day7, image: after },
        { countsUnclear: true },
      ),
    ).toBe(13);
  });
});

describe("which classes a day counts", () => {
  test("every class its model recognizes, unless it names fewer", () => {
    expect(resolveCountedClasses(SEED_CLASSES, undefined)).toEqual(
      SEED_CLASSES,
    );
    expect(resolveCountedClasses(SEED_CLASSES, ["germinated"])).toEqual([
      "germinated",
    ]);
  });

  test("in the order its model declares them", () => {
    expect(
      resolveCountedClasses(SEED_CLASSES, ["germinated", "ungerminated"]),
    ).toEqual(SEED_CLASSES);
  });

  test("never a class its model does not recognize", () => {
    expect(() => resolveCountedClasses(SEED_CLASSES, ["shoot"])).toThrow(
      UnknownClassError,
    );
  });
});

describe("an unclear photograph", () => {
  const day0 = observation(1);
  const day7 = observation(2);
  const cells = observationCells([
    cell("dish", day0.id, {
      detectionTally: { germinated: 4 },
      unclear: true,
    }),
    cell("dish", day7.id, { detectionTally: { germinated: 9 } }),
  ]);

  test("where unclear photographs do not count, leaves its own day without a trusted number", () => {
    const rule = { countsUnclear: false };
    // The number is still read, and shown; it is not trusted.
    expect(unitReading(cells, "dish", day0)).toEqual(unreviewed(4));
    expect(readingIsTrusted(cells, "dish", day0, rule)).toBe(false);
    // A one-day gap: the unit's later day reads as it is.
    expect(readingIsTrusted(cells, "dish", day7, rule)).toBe(true);
  });

  test("where unclear photographs count, is trusted", () => {
    expect(readingIsTrusted(cells, "dish", day0, { countsUnclear: true })).toBe(
      true,
    );
  });

  test("a clear photograph, or none, is trusted", () => {
    const rule = { countsUnclear: false };
    expect(readingIsTrusted(cells, "dish", day7, rule)).toBe(true);
    expect(readingIsTrusted(cells, "other", day0, rule)).toBe(true);
  });
});

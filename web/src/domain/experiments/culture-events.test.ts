import { describe, expect, test } from "bun:test";

import {
  CULTURE_EVENT_TYPES,
  type CultureEvent,
  type ExperimentObservation,
} from "./schema";
import {
  cultureEventExcludesFromAnalysis,
  cultureEventIsTerminal,
  latestCultureEvent,
  unitIsAvailableAt,
  unitIsIncludedInAnalysis,
} from "./culture-events";

const observations: ExperimentObservation[] = [
  {
    id: "5c5065a2-194d-4473-a48e-5ecbc9e8827d",
    ordinal: 1,
    observedOn: "2026-08-08",
    day: 7,
    note: "",
    modelVersionId: "seed-detector.traditional-v1",
    hasRecords: true,
  },
  {
    id: "71f62341-1071-4641-aa80-ac3b7f9c73e8",
    ordinal: 2,
    observedOn: "2026-08-15",
    day: 14,
    note: "",
    modelVersionId: "seed-detector.traditional-v1",
    hasRecords: false,
  },
];

const ordinals = new Map(
  observations.map((observation) => [observation.id, observation.ordinal]),
);

function event(overrides: Partial<CultureEvent>): CultureEvent {
  return {
    id: "d7863741-fbc8-439b-8a43-de9f3dfb613c",
    type: "discarded",
    observation: observations[0]!.id,
    recordedAt: "2026-08-08T12:00:00.000Z",
    ...overrides,
  };
}

describe("unit event effects", () => {
  test("each event type has one stable domain meaning", () => {
    expect(
      CULTURE_EVENT_TYPES.map((type) => [
        type,
        cultureEventIsTerminal(type),
        cultureEventExcludesFromAnalysis(type),
      ]),
    ).toEqual([
      ["contaminated", false, true],
      ["nonviable", false, false],
      ["discarded", true, true],
      ["harvested", true, false],
      ["missing", true, true],
    ]);
  });

  test("an event that takes the unit off the bench applies afterwards", () => {
    const events = [event({ type: "harvested" })];

    expect(unitIsAvailableAt(events, observations[0]!, ordinals)).toBeTrue();
    expect(
      unitIsIncludedInAnalysis(events, observations[0]!, ordinals),
    ).toBeTrue();
    expect(unitIsAvailableAt(events, observations[1]!, ordinals)).toBeFalse();
    expect(
      unitIsIncludedInAnalysis(events, observations[1]!, ordinals),
    ).toBeFalse();
  });

  test("an event the unit survives leaves it on the bench", () => {
    const events = [event({ type: "contaminated" })];

    expect(unitIsAvailableAt(events, observations[1]!, ordinals)).toBeTrue();
  });

  test("analysis exclusion starts in the recorded observation", () => {
    const events = [event({ type: "contaminated" })];

    expect(unitIsAvailableAt(events, observations[0]!, ordinals)).toBeTrue();
    expect(
      unitIsIncludedInAnalysis(events, observations[0]!, ordinals),
    ).toBeFalse();
    expect(
      unitIsIncludedInAnalysis(events, observations[1]!, ordinals),
    ).toBeFalse();
  });

  test("current state follows observation time rather than entry time", () => {
    const laterObservation = event({
      id: "c5c4c280-6592-4de0-9193-f2677e7a3e31",
      observation: observations[1]!.id,
      recordedAt: "2026-08-15T12:00:00.000Z",
      type: "contaminated",
    });
    const retrospectiveEntry = event({
      recordedAt: "2026-08-16T12:00:00.000Z",
      type: "nonviable",
    });

    expect(
      latestCultureEvent([laterObservation, retrospectiveEntry], ordinals)?.id,
    ).toBe(laterObservation.id);
  });
});

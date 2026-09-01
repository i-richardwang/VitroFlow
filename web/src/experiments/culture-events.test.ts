import { describe, expect, test } from "bun:test";

import type { CultureEvent, ExperimentObservation } from "./schema";
import {
  observationUnitIsAvailableAt,
  observationUnitIsIncludedInAnalysis,
  latestActiveCultureEvent,
} from "./culture-events";

const observations: ExperimentObservation[] = [
  {
    id: "5c5065a2-194d-4473-a48e-5ecbc9e8827d",
    ordinal: 1,
    observedOn: "2026-08-08",
    day: 7,
    note: "",
    hasRecords: true,
  },
  {
    id: "71f62341-1071-4641-aa80-ac3b7f9c73e8",
    ordinal: 2,
    observedOn: "2026-08-15",
    day: 14,
    note: "",
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
    excludeFromObservation: false,
    removeAfterObservation: false,
    note: "",
    recordedAt: "2026-08-08T12:00:00.000Z",
    voidedAt: null,
    voidReason: "",
    ...overrides,
  };
}

describe("observation unit event effects", () => {
  test("physical removal starts after the recorded observation", () => {
    const events = [event({ removeAfterObservation: true })];

    expect(
      observationUnitIsAvailableAt(events, observations[0]!, ordinals),
    ).toBeTrue();
    expect(
      observationUnitIsIncludedInAnalysis(events, observations[0]!, ordinals),
    ).toBeTrue();
    expect(
      observationUnitIsAvailableAt(events, observations[1]!, ordinals),
    ).toBeFalse();
    expect(
      observationUnitIsIncludedInAnalysis(events, observations[1]!, ordinals),
    ).toBeFalse();
  });

  test("analysis exclusion starts in the recorded observation", () => {
    const events = [event({ excludeFromObservation: true })];

    expect(
      observationUnitIsAvailableAt(events, observations[0]!, ordinals),
    ).toBeTrue();
    expect(
      observationUnitIsIncludedInAnalysis(events, observations[0]!, ordinals),
    ).toBeFalse();
    expect(
      observationUnitIsIncludedInAnalysis(events, observations[1]!, ordinals),
    ).toBeFalse();
  });

  test("voided events have no active effect", () => {
    const events = [
      event({
        excludeFromObservation: true,
        removeAfterObservation: true,
        voidedAt: "2026-08-09T12:00:00.000Z",
        voidReason: "Recorded for the wrong observation unit",
      }),
    ];

    expect(
      observationUnitIsAvailableAt(events, observations[1]!, ordinals),
    ).toBeTrue();
    expect(
      observationUnitIsIncludedInAnalysis(events, observations[1]!, ordinals),
    ).toBeTrue();
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
      latestActiveCultureEvent([laterObservation, retrospectiveEntry], ordinals)
        ?.id,
    ).toBe(laterObservation.id);
  });
});

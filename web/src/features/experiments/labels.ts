import { m } from "../../paraglide/messages";
import type {
  ExperimentObservation,
  CultureEventType,
} from "../../domain/experiments/schema";

export function observationLabel(observation: ExperimentObservation): string {
  return m.observation_day_label({ day: observation.day });
}

const CULTURE_EVENT_LABELS: Record<CultureEventType, () => string> = {
  contaminated: m.culture_event_contaminated,
  nonviable: m.culture_event_nonviable,
  discarded: m.culture_event_discarded,
  harvested: m.culture_event_harvested,
  missing: m.culture_event_missing,
};

export function cultureEventLabel(type: CultureEventType): string {
  return CULTURE_EVENT_LABELS[type]();
}

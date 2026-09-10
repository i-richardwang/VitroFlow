import {
  MODEL_RECORD_KINDS,
  type ModelRecordKind,
  type ModelRecords,
} from "../../domain/models/contracts";
import { m } from "../../paraglide/messages";

const LABELS: Record<ModelRecordKind, (input: { count: number }) => string> = {
  versions: m.model_records_versions,
  observations: m.model_records_observations,
  annotations: m.model_records_annotations,
  datasets: m.model_records_datasets,
  trainingRuns: m.model_records_training_runs,
};

/**
 * What holds a task in place, or nothing when it is free to withdraw: the same
 * records the workbench refuses a withdrawal for, named in the reader's
 * language.
 */
export function modelRecordsSummary(records: ModelRecords): string | null {
  const held = MODEL_RECORD_KINDS.filter((kind) => records[kind] > 0).map(
    (kind) => LABELS[kind]({ count: records[kind] }),
  );
  return held.length > 0 ? held.join(" · ") : null;
}

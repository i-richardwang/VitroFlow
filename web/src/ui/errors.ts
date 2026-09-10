import { businessFailureSchema } from "../domain/errors";
import { m } from "../paraglide/messages";

/** RPC failures are validated data, never reconstructed Error subclasses. */
export function errorMessage(error: unknown): string {
  const failure = businessFailureSchema.safeParse(error);
  if (failure.success) {
    const labels: Record<string, () => string> = {
      training_run_conflict: m.error_training_conflict,
      training_artifact_validation: m.error_training_artifact,
      dataset_model_mismatch: m.error_dataset_model,
      model_id_taken: m.error_model_id_taken,
      model_in_use: m.error_model_in_use,
      experiment_observation_image_already_used: m.error_image_already_used,
      experiment_has_records: m.error_experiment_has_records,
      user_rejected: m.error_user_rejected,
    };
    const label = labels[failure.data.code];
    if (label) return label();
    return {
      not_found: m.error_not_found,
      conflict: m.error_conflict,
      invalid_request: m.error_invalid_request,
    }[failure.data.category]();
  }
  return error instanceof Error ? error.message : String(error);
}

import {
  MODEL_RECORD_KINDS,
  type ModelRecords,
} from "../../domain/models/contracts";

/**
 * Whether nothing holds a model in place, so it is free to withdraw: the
 * same records the workbench refuses a withdrawal for.
 */
export function modelIsFree(records: ModelRecords): boolean {
  return MODEL_RECORD_KINDS.every((kind) => records[kind] === 0);
}

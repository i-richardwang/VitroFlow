import { z } from "zod";
import { query, command } from "./definition";
import {
  modelRefSchema,
  modelVersionRefSchema,
  modelVersionSchema,
} from "../../domain/models/schema";
import {
  modelImportSchema,
  modelUploadRefSchema,
  modelUploadSchema,
} from "../../domain/models/bundle";
import {
  prepareModelUpload,
  importModelUpload,
  listModelVersions,
  setCurrentVersion,
} from "../models/public";

export const modelOperations = [
  query({
    name: "list-model-versions",
    description:
      "List up to 100 newest immutable versions for a recognition model, including locally trained imports",
    input: modelRefSchema,
    output: z.array(modelVersionSchema),
    handler: ({ model }) => listModelVersions(model),
  }),
  command({
    name: "prepare-model-upload",
    description:
      "Validate a model bundle and reserve an idempotent upload. Send weight bytes to uploadPath with an experiments-scoped API key, then call register-model-upload. Does not activate the model.",
    destructive: false,
    transactional: false,
    input: modelImportSchema,
    output: modelUploadSchema,
    handler: ({ model, bundle }) => prepareModelUpload(model, bundle),
  }),
  command({
    name: "register-model-upload",
    description:
      "Register uploaded weights as an immutable model version without training or changing the current version",
    destructive: false,
    transactional: false,
    input: modelUploadRefSchema,
    output: modelVersionSchema,
    handler: ({ uploadId }) => importModelUpload(uploadId),
  }),
  command({
    name: "use-model-version",
    description:
      "Select an existing model version for inference. Does not train; selecting an earlier version rolls back the choice.",
    destructive: true,
    transactional: false,
    input: modelVersionRefSchema,
    output: z.null(),
    handler: async (input) => {
      await setCurrentVersion(input);
      return null;
    },
  }),
];

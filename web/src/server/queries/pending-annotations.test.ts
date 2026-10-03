import { expect, test } from "bun:test";

import { storeAnnotation } from "../annotations/documents";
import { addExperimentObservationImages } from "../datasets/memberships";
import { createModel, setModelAnnotation } from "../models/public";
import { observeImagesForModel } from "../testing/fixtures";
import { listPendingAnnotations } from "./pending-annotations";

test("an image waits once per model until someone reads it, and only for a model with instructions", async () => {
  const annotation = {
    area: "image" as const,
    instructions: "Box every seed.",
    coreSize: 512,
    halo: 32,
    displayScale: 1,
  };
  const model = await createModel({
    id: "awaiting-agent-model",
    name: "Pending",
    classes: ["seed"],
    annotation,
  });
  const observed = await observeImagesForModel(
    "awaiting-agent",
    ["awaiting-agent-a", "awaiting-agent-b"],
    model.id,
  );
  await addExperimentObservationImages({
    dataset: "awaiting-agent",
    images: observed.images,
  });
  const listed = async () =>
    (await listPendingAnnotations(model.id)).images.map(
      (image) => image.ref.digest,
    );
  expect((await listed()).sort()).toEqual([...observed.digests].sort());

  await storeAnnotation(
    { digest: observed.digests[0]!, modelId: model.id },
    [],
    null,
  );
  expect(await listed()).toEqual([observed.digests[1]!]);

  await setModelAnnotation({
    model: model.id,
    annotation: { ...annotation, instructions: "" },
  });
  expect(await listPendingAnnotations(model.id)).toEqual({
    total: 0,
    images: [],
  });
});

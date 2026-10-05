import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import type { Crumb } from "../../ui/shell/crumbs";
import { modelName } from "../../ui/model-names";

/** The way down to a model: the model list, then the model itself. */
export function modelCrumbs(model: Model): Crumb[] {
  return [
    { label: m.models_title(), href: "/models" },
    { label: modelName(model), href: `/models/${model.id}` },
  ];
}

/** The way down to one of a model's training sets. */
export function datasetCrumbs(model: Model, dataset: string): Crumb[] {
  return [
    ...modelCrumbs(model),
    { label: dataset, href: `/datasets/${dataset}` },
  ];
}

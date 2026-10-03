import { imageRegions } from "../images/regions";
import type { ImageRegion } from "../images/geometry";
import { AnnotationRunConflictError } from "./errors";
import { z } from "zod";
import type { AnnotationContent, AnnotationDefinition } from "./schema";
import {
  annotationSchema,
  type AnnotationInstance,
  type BoundingBox,
} from "../annotation/schema";

const edge = z.number().min(0).max(1000);
const box = z
  .array(edge)
  .length(4)
  .refine(
    (edges) => edges[0]! < edges[2]! && edges[1]! < edges[3]!,
    "Box edges must be ordered",
  );
const regionProposalSchema = z.strictObject({
  instances: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(128),
        class: z.string().min(1).max(128),
        box_2d: box,
        uncertain: z.boolean().default(false),
        truncated: z.boolean().default(false),
      }),
    )
    .max(10000),
  issues: z
    .array(z.strictObject({ box_2d: box, reason: z.string().min(1).max(2000) }))
    .max(10000)
    .default([]),
});
export type RegionProposal = z.infer<typeof regionProposalSchema>;
export type Region = ImageRegion;

/** The grid an image is cut into for a model, whatever a run redraws. */
export function tiles(definition: AnnotationDefinition): Region[] {
  return imageRegions(definition.image, definition.config);
}

/** The frozen coverage and optional redraw scope select unchanged grid tiles. */
export function regions(definition: AnnotationDefinition): Region[] {
  return imageRegions(
    definition.image,
    definition.config,
    definition.scope,
    definition.coverage,
  );
}

function sourceBox(edges: number[], patch: BoundingBox): BoundingBox {
  const [top, left, bottom, right] = edges as [number, number, number, number];
  const x = patch.x + (left * patch.width) / 1000;
  const y = patch.y + (top * patch.height) / 1000;
  // Derive extents from the same edges, including the exact source boundary.
  return {
    x,
    y,
    width: patch.x + (right * patch.width) / 1000 - x,
    height: patch.y + (bottom * patch.height) / 1000 - y,
  };
}
export function owns(core: BoundingBox, box: BoundingBox): boolean {
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  return (
    x >= core.x &&
    x < core.x + core.width &&
    y >= core.y &&
    y < core.y + core.height
  );
}
export function prepareProposal(
  value: unknown,
  region: Region,
  definition: AnnotationDefinition,
) {
  const response = regionProposalSchema.parse(value);
  return { response, content: projectProposal(response, region, definition) };
}

/** Preview and collection use the same owned boxes and the same source geometry. */
export function projectProposal(
  proposal: RegionProposal,
  region: Region,
  definition: AnnotationDefinition,
): AnnotationContent {
  const instances: AnnotationInstance[] = [];
  const uncertainIds: string[] = [];
  const ids = new Set<string>();
  for (const item of proposal.instances) {
    if (ids.has(item.id))
      throw new AnnotationRunConflictError("Duplicate instance ID");
    ids.add(item.id);
    if (!definition.config.classes.includes(item.class))
      throw new AnnotationRunConflictError("Unknown annotation class");
    const bbox = sourceBox(item.box_2d, region.patch);
    if (!owns(region.core, bbox)) continue;
    const [top, left, bottom, right] = item.box_2d;
    const p = region.patch;
    if (
      (left === 0 && p.x > 0) ||
      (top === 0 && p.y > 0) ||
      (right === 1000 && p.x + p.width < definition.image.width) ||
      (bottom === 1000 && p.y + p.height < definition.image.height)
    )
      throw new AnnotationRunConflictError(
        "Owned box touches an internal patch boundary; use a larger halo in a new run",
      );
    instances.push({ id: item.id, class: item.class, bbox });
    if (
      item.uncertain ||
      item.truncated ||
      item.box_2d.some((edge) => edge === 0 || edge === 1000)
    )
      uncertainIds.push(item.id);
  }
  return {
    document: annotationSchema.parse({
      schemaVersion: 1,
      image: definition.image,
      instances,
    }),
    issues: proposal.issues.flatMap((issue) => {
      const bbox = sourceBox(issue.box_2d, region.patch);
      return owns(region.core, bbox) ? [{ bbox, reason: issue.reason }] : [];
    }),
    uncertainIds,
  };
}

export const annotationTaskInput = z.strictObject({
  taskId: z.string().min(1),
});
export const annotationPreviewInput = annotationTaskInput.extend(
  regionProposalSchema.shape,
);
export const annotationSubmitInput = annotationTaskInput.extend({
  proposalId: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Flag strong cross-region overlap without merging naturally touching objects. */
export function seamWarnings(
  instances: (AnnotationInstance & { taskId: string })[],
): string[] {
  const ordered = [...instances].sort((a, b) => a.bbox.x - b.bbox.x);
  let active: typeof ordered = [];
  const warnings: string[] = [];
  for (const current of ordered) {
    const b = current.bbox;
    active = active.filter((item) => item.bbox.x + item.bbox.width > b.x);
    for (const previous of active) {
      if (
        previous.taskId === current.taskId ||
        previous.class !== current.class
      )
        continue;
      const a = previous.bbox;
      const width = Math.min(a.x + a.width, b.x + b.width) - b.x;
      const height = Math.max(
        0,
        Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
      );
      if (
        (width * height) / Math.min(a.width * a.height, b.width * b.height) >
        0.5
      ) {
        warnings.push(
          JSON.stringify({
            code: "possible-seam-duplicate",
            instanceIds: [previous.id, current.id],
          }),
        );
        if (warnings.length === 9999)
          return [...warnings, "Further seam duplicate warnings omitted"];
      }
    }
    active.push(current);
  }
  return warnings;
}

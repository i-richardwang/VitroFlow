import { AnnotationRunConflictError } from "./errors";
import { z } from "zod";
import type { AnnotationDefinition } from "./schema";
import type { AnnotationInstance, BoundingBox } from "../annotation/schema";

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
export type Region = { id: string; core: BoundingBox; patch: BoundingBox };

export function regions(definition: AnnotationDefinition): Region[] {
  const { width, height } = definition.image;
  const { coreSize, halo } = definition.config;
  const result: Region[] = [];
  for (let y = 0, row = 0; y < height; y += coreSize, row++) {
    for (let x = 0, col = 0; x < width; x += coreSize, col++) {
      const core = {
        x,
        y,
        width: Math.min(coreSize, width - x),
        height: Math.min(coreSize, height - y),
      };
      const left = Math.max(0, x - halo),
        top = Math.max(0, y - halo);
      result.push({
        id: `tile-${String(row).padStart(3, "0")}-${String(col).padStart(3, "0")}`,
        core,
        patch: {
          x: left,
          y: top,
          width: Math.min(width, x + core.width + halo) - left,
          height: Math.min(height, y + core.height + halo) - top,
        },
      });
    }
  }
  return result;
}

export function sourceBox(edges: number[], patch: BoundingBox): BoundingBox {
  const [top, left, bottom, right] = edges as [number, number, number, number];
  return {
    x: patch.x + (left * patch.width) / 1000,
    y: patch.y + (top * patch.height) / 1000,
    width: ((right - left) * patch.width) / 1000,
    height: ((bottom - top) * patch.height) / 1000,
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
export function validateProposal(
  value: unknown,
  region: Region,
  definition: AnnotationDefinition,
): RegionProposal {
  const proposal = regionProposalSchema.parse(value);
  const ids = new Set<string>();
  for (const instance of proposal.instances) {
    if (ids.has(instance.id))
      throw new AnnotationRunConflictError("Duplicate instance ID");
    ids.add(instance.id);
    if (!definition.config.classes.includes(instance.class))
      throw new AnnotationRunConflictError("Unknown annotation class");
    const box = sourceBox(instance.box_2d, region.patch);
    if (!owns(region.core, box)) continue;
    const [top, left, bottom, right] = instance.box_2d;
    const p = region.patch;
    if (
      (left === 0 && p.x > 0) ||
      (top === 0 && p.y > 0) ||
      (right === 1000 && p.x + p.width < definition.image.width) ||
      (bottom === 1000 && p.y + p.height < definition.image.height)
    ) {
      throw new AnnotationRunConflictError(
        "Owned box touches an internal patch boundary; use a larger halo in a new run",
      );
    }
  }
  return proposal;
}

export const annotationViewInput = z.strictObject({
  taskId: z.string().min(1),
});
export const annotationPreviewInput = annotationViewInput.extend(
  regionProposalSchema.shape,
);
export const annotationSubmitInput = annotationViewInput.extend({
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

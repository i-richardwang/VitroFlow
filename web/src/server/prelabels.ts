import * as fs from "node:fs";
import { createHash } from "node:crypto";

import { boxAround } from "../annotation/geometry";
import type { ImageRef } from "../datasets/schema";
import {
  legacyPrelabelSchema,
  prelabelSchema,
  type LegacyPrelabel,
  type Prelabel,
  type PrelabelerDescriptor,
} from "../detection/schema";
import {
  findImage,
  listDatasets,
  listImages,
  type DatasetImage,
} from "./datasets";
import { writeAtomically } from "./files";
import { hasLabel } from "./labels";
import { PRELABELS_DIR, resolveWithin } from "./paths";

/** Thrown when a worker tries to replace the prelabel a review started from. */
export class PrelabelFrozenError extends Error {
  constructor(ref: ImageRef) {
    super(`${ref.dataset}/${ref.stem} is labelled; its prelabel is frozen`);
  }
}

function prelabelPath({ dataset, stem }: ImageRef): string {
  return resolveWithin(PRELABELS_DIR, dataset, `${stem}.json`);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Cannot fingerprint a non-JSON configuration value");
  }
  return serialized;
}

function legacyProducer(prelabel: LegacyPrelabel): PrelabelerDescriptor {
  const fingerprint = createHash("sha256")
    .update(prelabel.pipeline.fingerprint)
    .update("\0")
    .update(prelabel.model.fingerprint)
    .update("\0")
    .update(canonicalJson(prelabel.config))
    .digest("hex");
  return {
    version_id: `traditional-${fingerprint.slice(0, 12)}`,
    name: prelabel.model.name,
    kind: "traditional",
    fingerprint,
  };
}

function legacyMetrics(prelabel: LegacyPrelabel): Record<string, number> {
  if ("error" in prelabel) {
    return {};
  }
  const metrics: Record<string, number> = {
    clipped_fraction: prelabel.quality.clipped_fraction,
    focus_score: prelabel.quality.focus_score,
  };
  const decision = prelabel.config.decision;
  if (
    typeof decision === "object" &&
    decision !== null &&
    "confidence_threshold" in decision &&
    typeof decision.confidence_threshold === "number"
  ) {
    metrics.confidence_threshold = decision.confidence_threshold;
  }
  return metrics;
}

/** Converts old center/scale documents once at the storage boundary. */
function migrateLegacyPrelabel(prelabel: LegacyPrelabel): Prelabel {
  const producer = legacyProducer(prelabel);
  if ("error" in prelabel) {
    return {
      schema_version: 1,
      source: prelabel.source,
      producer,
      error: prelabel.error,
    };
  }
  if (prelabel.count !== prelabel.detections.length) {
    throw new Error("Legacy prelabel count does not match its detections");
  }
  const side = prelabel.dish.radius * 0.025;
  const instances = prelabel.detections.flatMap((detection) => {
    const bbox = boxAround(detection, side, prelabel.image);
    return bbox
      ? [
          {
            id: String(detection.id),
            class: "seed" as const,
            bbox,
            score: detection.score,
          },
        ]
      : [];
  });
  return prelabelSchema.parse({
    schema_version: 1,
    source: prelabel.source,
    image: prelabel.image,
    producer,
    instances,
    quality: {
      status: prelabel.quality.status,
      warnings: prelabel.quality.warnings,
    },
    diagnostics: {
      dish: prelabel.dish,
      metrics: legacyMetrics(prelabel),
    },
  });
}

export function readPrelabel(ref: ImageRef): Prelabel | null {
  const filePath = prelabelPath(ref);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const document: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const current = prelabelSchema.safeParse(document);
  return current.success
    ? current.data
    : migrateLegacyPrelabel(legacyPrelabelSchema.parse(document));
}

export function writePrelabel(ref: ImageRef, document: unknown): Prelabel {
  const image = findImage(ref);
  if (!image) {
    throw new Error(`No image ${ref.stem} in dataset ${ref.dataset}`);
  }
  const prelabel = prelabelSchema.parse(document);
  if (prelabel.source !== image.source) {
    throw new Error(
      `Prelabel source ${prelabel.source} does not match ${image.source}`,
    );
  }
  if (hasLabel(ref)) {
    throw new PrelabelFrozenError(ref);
  }
  writeAtomically(prelabelPath(ref), `${JSON.stringify(prelabel, null, 2)}\n`);
  return prelabel;
}

/** Drops a prelabel so the next worker pass processes the image again. */
export function discardPrelabel(ref: ImageRef): void {
  if (hasLabel(ref)) {
    throw new PrelabelFrozenError(ref);
  }
  fs.rmSync(prelabelPath(ref), { force: true });
}

export interface PrelabelerIdentity {
  version_id: string;
  fingerprint: string;
}

/**
 * Images a worker with the given pipeline and model should process: those
 * without a prelabel, and unlabelled ones whose prelabel came from a
 * different prelabeler version.
 */
export function pendingImages(prelabeler: PrelabelerIdentity): DatasetImage[] {
  return listDatasets().flatMap((dataset) =>
    listImages(dataset).filter((image) => {
      if (hasLabel(image)) {
        return false;
      }
      const prelabel = readPrelabel(image);
      return (
        prelabel === null ||
        prelabel.producer.version_id !== prelabeler.version_id ||
        prelabel.producer.fingerprint !== prelabeler.fingerprint
      );
    }),
  );
}

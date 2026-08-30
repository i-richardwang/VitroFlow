import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { database, transaction, type Executor } from "../db/client";
import {
  detectionFailures,
  detections,
  experimentDishes,
  experimentPhotos,
  experimentRounds,
  experiments,
  images,
  labels,
  modelVersions,
} from "../db/schema";
import type { AnnotationDocument } from "../annotation/schema";
import type { DetectionFailure, DetectionResult } from "../detection/schema";
import {
  compareDishLabels,
  dishLabel,
  experimentRequestSchema,
  experimentRoundSchema,
  experimentSchema,
  roundRequestSchema,
  type Experiment,
  type ExperimentRound,
  type PhotoRef,
  type PhotoState,
} from "../experiments/schema";
import type { ModelVersion } from "../models/schema";
import { imageBlobKey } from "./blobs";
import { clearDetectionFailure } from "./detections";
import { lockImage } from "./image-lock";
import { readModelVersion, toModelVersion } from "./model-registry";

export interface ExperimentDish {
  label: string;
  position: number;
}

/**
 * One grid cell with only the projections the grid needs. `count` is what the
 * experiment's version found; `reviewed` is the reviewer's count for that
 * model once a review of the photograph is complete.
 */
export interface PhotoCell {
  dish: string;
  round: string;
  digest: string;
  filename: string;
  state: PhotoState;
  count: number | null;
  reviewed: number | null;
  error: string | null;
}

export interface ExperimentGrid {
  experiment: Experiment;
  version: ModelVersion;
  dishes: ExperimentDish[];
  rounds: ExperimentRound[];
  photos: PhotoCell[];
}

export interface ExperimentSummary {
  experiment: Experiment;
  version: ModelVersion;
  dishes: number;
  rounds: number;
  counts: Record<PhotoState, number>;
}

/** A photograph with the documents its page shows. */
export interface ExperimentPhoto {
  ref: PhotoRef;
  experimentName: string;
  round: ExperimentRound;
  digest: string;
  filename: string;
  width: number;
  height: number;
  blobKey: string;
  modelVersionId: string;
  modelId: string;
  detection: DetectionResult | null;
  failure: DetectionFailure | null;
  /** The review of this photograph for the experiment's model. */
  label: AnnotationDocument | null;
}

export class ExperimentNotFoundError extends Error {}
export class ImagesNotStoredError extends Error {}
export class ExperimentPhotoNotFoundError extends Error {}
export class RoundRejectedError extends Error {}

export interface UsedExperimentPhoto {
  digest: string;
  filename: string;
  dish: string;
  round: string;
  roundLabel: string;
}

export class ExperimentPhotoAlreadyUsedError extends Error {
  constructor(public readonly photos: UsedExperimentPhoto[]) {
    const [first] = photos;
    super(
      first
        ? `${first.filename} was already used for dish ${first.dish} in ${first.roundLabel}`
        : "A photograph was already used in this experiment",
    );
  }
}

function toExperiment(row: typeof experiments.$inferSelect): Experiment {
  return experimentSchema.parse({
    schemaVersion: 1,
    id: row.id,
    name: row.name,
    modelVersionId: row.modelVersionId,
    createdAt: row.createdAt.toISOString(),
  });
}

function toRound(row: typeof experimentRounds.$inferSelect): ExperimentRound {
  return experimentRoundSchema.parse({
    id: row.id,
    label: row.label,
    capturedAt: row.capturedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  });
}

export async function readExperiment(
  experimentId: string,
  db?: Executor,
): Promise<Experiment | null> {
  const [row] = await (db ?? (await database()))
    .select()
    .from(experiments)
    .where(eq(experiments.id, experimentId));
  return row ? toExperiment(row) : null;
}

/** Creates one experiment with a Server-owned identity and a fixed version. */
export async function createExperiment(value: unknown): Promise<Experiment> {
  const { name, modelVersionId } = experimentRequestSchema.parse(value);
  const version = await readModelVersion(modelVersionId);
  if (!version) throw new Error(`Unknown model version: ${modelVersionId}`);
  const [row] = await (
    await database()
  )
    .insert(experiments)
    .values({ id: randomUUID(), name, modelVersionId, createdAt: new Date() })
    .returning();
  if (!row) throw new Error("Experiment was not created");
  return toExperiment(row);
}

/** Grid rows never load full detection documents merely to show a count. */
function photoGridQuery(db: Executor) {
  return db
    .select({
      photo: experimentPhotos,
      detectionImageId: detections.imageId,
      failureImageId: detectionFailures.imageId,
      count: sql<
        number | null
      >`case when ${detections.imageId} is null then null else jsonb_array_length(${detections.document}->'instances') end`,
      reviewed: sql<
        number | null
      >`case when ${labels.status} = 'complete' then jsonb_array_length(${labels.document}->'instances') end`,
      error: sql<string | null>`${detectionFailures.document}->>'error'`,
    })
    .from(experimentPhotos)
    .innerJoin(experiments, eq(experiments.id, experimentPhotos.experimentId))
    .innerJoin(modelVersions, eq(modelVersions.id, experiments.modelVersionId))
    .leftJoin(
      labels,
      and(
        eq(labels.imageId, experimentPhotos.imageId),
        eq(labels.modelId, modelVersions.modelId),
      ),
    )
    .leftJoin(
      detections,
      and(
        eq(detections.imageId, experimentPhotos.imageId),
        eq(detections.modelVersionId, experiments.modelVersionId),
      ),
    )
    .leftJoin(
      detectionFailures,
      and(
        eq(detectionFailures.imageId, experimentPhotos.imageId),
        eq(detectionFailures.modelVersionId, experiments.modelVersionId),
      ),
    );
}

type PhotoGridRow = Awaited<ReturnType<typeof photoGridQuery>>[number];

function toCell(row: PhotoGridRow): PhotoCell {
  const state: PhotoState = row.detectionImageId
    ? "counted"
    : row.failureImageId
      ? "failed"
      : "pending";
  return {
    dish: row.photo.dishLabel,
    round: row.photo.roundId,
    digest: row.photo.imageId,
    filename: row.photo.filename,
    state,
    count: row.count == null ? null : Number(row.count),
    reviewed: row.reviewed == null ? null : Number(row.reviewed),
    error: row.error,
  };
}

async function listDishes(
  experimentId: string,
  db: Executor,
): Promise<ExperimentDish[]> {
  return db
    .select({
      label: experimentDishes.label,
      position: experimentDishes.position,
    })
    .from(experimentDishes)
    .where(eq(experimentDishes.experimentId, experimentId))
    .orderBy(asc(experimentDishes.position));
}

async function listRounds(
  experimentId: string,
  db: Executor,
): Promise<ExperimentRound[]> {
  const rows = await db
    .select()
    .from(experimentRounds)
    .where(eq(experimentRounds.experimentId, experimentId))
    .orderBy(asc(experimentRounds.capturedAt), asc(experimentRounds.id));
  return rows.map(toRound);
}

async function listCells(
  experimentId: string,
  db: Executor,
): Promise<PhotoCell[]> {
  const rows = await photoGridQuery(db)
    .where(eq(experimentPhotos.experimentId, experimentId))
    .orderBy(asc(experimentPhotos.dishLabel), asc(experimentPhotos.roundId));
  return rows.map(toCell);
}

export async function readExperimentGrid(
  experimentId: string,
): Promise<ExperimentGrid | null> {
  const db = await database();
  const experiment = await readExperiment(experimentId, db);
  if (!experiment) return null;
  const version = await readModelVersion(experiment.modelVersionId, db);
  if (!version) {
    throw new Error(`Unknown model version: ${experiment.modelVersionId}`);
  }
  const [dishes, rounds, photos] = await Promise.all([
    listDishes(experimentId, db),
    listRounds(experimentId, db),
    listCells(experimentId, db),
  ]);
  return { experiment, version, dishes, rounds, photos };
}

/** Fixed-size aggregate queries; summaries never fetch outcome documents. */
export async function listExperiments(): Promise<ExperimentSummary[]> {
  const db = await database();
  const [base, dishRows, roundRows, photoRows] = await Promise.all([
    db
      .select({ experiment: experiments, version: modelVersions })
      .from(experiments)
      .innerJoin(
        modelVersions,
        eq(modelVersions.id, experiments.modelVersionId),
      )
      .orderBy(
        desc(experiments.createdAt),
        asc(experiments.name),
        asc(experiments.id),
      ),
    db
      .select({
        experimentId: experimentDishes.experimentId,
        total: sql<number>`count(*)`,
      })
      .from(experimentDishes)
      .groupBy(experimentDishes.experimentId),
    db
      .select({
        experimentId: experimentRounds.experimentId,
        total: sql<number>`count(*)`,
      })
      .from(experimentRounds)
      .groupBy(experimentRounds.experimentId),
    db
      .select({
        experimentId: experimentPhotos.experimentId,
        pending: sql<number>`count(*) filter (where ${detections.imageId} is null and ${detectionFailures.imageId} is null)`,
        failed: sql<number>`count(*) filter (where ${detections.imageId} is null and ${detectionFailures.imageId} is not null)`,
        counted: sql<number>`count(${detections.imageId})`,
      })
      .from(experimentPhotos)
      .innerJoin(experiments, eq(experiments.id, experimentPhotos.experimentId))
      .leftJoin(
        detections,
        and(
          eq(detections.imageId, experimentPhotos.imageId),
          eq(detections.modelVersionId, experiments.modelVersionId),
        ),
      )
      .leftJoin(
        detectionFailures,
        and(
          eq(detectionFailures.imageId, experimentPhotos.imageId),
          eq(detectionFailures.modelVersionId, experiments.modelVersionId),
        ),
      )
      .groupBy(experimentPhotos.experimentId),
  ]);
  const dishes = new Map(
    dishRows.map((row) => [row.experimentId, Number(row.total)]),
  );
  const rounds = new Map(
    roundRows.map((row) => [row.experimentId, Number(row.total)]),
  );
  const counts = new Map(
    photoRows.map((row) => [
      row.experimentId,
      {
        pending: Number(row.pending),
        failed: Number(row.failed),
        counted: Number(row.counted),
      },
    ]),
  );
  return base.map((row) => ({
    experiment: toExperiment(row.experiment),
    version: toModelVersion(row.version),
    dishes: dishes.get(row.experiment.id) ?? 0,
    rounds: rounds.get(row.experiment.id) ?? 0,
    counts: counts.get(row.experiment.id) ?? {
      pending: 0,
      failed: 0,
      counted: 0,
    },
  }));
}

type ParsedRoundRequest = ReturnType<typeof roundRequestSchema.parse>;

/** Filenames name each dish exactly once after canonical normalization. */
function dishesOf(
  photos: ParsedRoundRequest["photos"],
): Map<string, ParsedRoundRequest["photos"][number]> {
  const byLabel = new Map<string, ParsedRoundRequest["photos"][number]>();
  for (const photo of photos) {
    const label = dishLabel(photo.filename);
    if (!label) {
      throw new RoundRejectedError(`${photo.filename} does not name a dish`);
    }
    const other = byLabel.get(label);
    if (other) {
      throw new RoundRejectedError(
        `${other.filename} and ${photo.filename} both photograph dish ${label}`,
      );
    }
    byLabel.set(label, photo);
  }
  return byLabel;
}

export interface RoundResult {
  round: ExperimentRound;
  photos: number;
}

/** Adds one named, captured occasion atomically under the fixed dish roster. */
export async function addRound(value: unknown): Promise<RoundResult> {
  const {
    experiment: experimentId,
    label,
    capturedAt: capturedAtText,
    photos,
  } = roundRequestSchema.parse(value);
  const byLabel = dishesOf(photos);
  const digests = [...new Set(photos.map((photo) => photo.digest))].sort();
  if (digests.length !== photos.length) {
    throw new RoundRejectedError("The same photograph is listed twice");
  }
  const roundId = randomUUID();
  const capturedAt = new Date(capturedAtText);
  const createdAt = new Date();

  return transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: experiments.id })
      .from(experiments)
      .where(eq(experiments.id, experimentId))
      .for("update");
    if (!locked) {
      throw new ExperimentNotFoundError(`Unknown experiment: ${experimentId}`);
    }

    const [sameLabel] = await tx
      .select({ id: experimentRounds.id })
      .from(experimentRounds)
      .where(
        and(
          eq(experimentRounds.experimentId, experimentId),
          eq(experimentRounds.label, label),
        ),
      );
    if (sameLabel) {
      throw new RoundRejectedError(`Round ${label} already exists`);
    }

    for (const digest of digests) await lockImage(digest, tx);
    const stored = await tx
      .select({ id: images.id })
      .from(images)
      .where(inArray(images.id, digests));
    if (stored.length !== digests.length) {
      throw new ImagesNotStoredError(
        "Some photos are no longer stored; upload them again",
      );
    }

    const used = await tx
      .select({
        digest: experimentPhotos.imageId,
        filename: experimentPhotos.filename,
        dish: experimentPhotos.dishLabel,
        round: experimentRounds.id,
        roundLabel: experimentRounds.label,
      })
      .from(experimentPhotos)
      .innerJoin(
        experimentRounds,
        and(
          eq(experimentRounds.experimentId, experimentPhotos.experimentId),
          eq(experimentRounds.id, experimentPhotos.roundId),
        ),
      )
      .where(
        and(
          eq(experimentPhotos.experimentId, experimentId),
          inArray(experimentPhotos.imageId, digests),
        ),
      );
    if (used.length > 0) throw new ExperimentPhotoAlreadyUsedError(used);

    const roster = await listDishes(experimentId, tx);
    if (roster.length === 0) {
      const labels = [...byLabel.keys()].sort(compareDishLabels);
      await tx.insert(experimentDishes).values(
        labels.map((dish, index) => ({
          experimentId,
          label: dish,
          position: index + 1,
        })),
      );
    } else {
      const known = new Set(roster.map((dish) => dish.label));
      const unknown = [...byLabel.keys()].filter((dish) => !known.has(dish));
      if (unknown.length > 0) {
        throw new RoundRejectedError(
          `Not dishes of this experiment: ${unknown.sort(compareDishLabels).join(", ")}`,
        );
      }
    }

    const [roundRow] = await tx
      .insert(experimentRounds)
      .values({
        experimentId,
        id: roundId,
        label,
        capturedAt,
        createdAt,
      })
      .returning();
    if (!roundRow) throw new Error("Round was not created");
    await tx.insert(experimentPhotos).values(
      [...byLabel].map(([dish, photo]) => ({
        experimentId,
        dishLabel: dish,
        roundId,
        imageId: photo.digest,
        filename: photo.filename,
      })),
    );
    return { round: toRound(roundRow), photos: byLabel.size };
  });
}

function atPhoto({ experiment, dish, round }: PhotoRef) {
  return and(
    eq(experimentPhotos.experimentId, experiment),
    eq(experimentPhotos.dishLabel, dish),
    eq(experimentPhotos.roundId, round),
  );
}

export async function readExperimentPhoto(
  ref: PhotoRef,
  db?: Executor,
): Promise<ExperimentPhoto | null> {
  const [row] = await (db ?? (await database()))
    .select({
      photo: experimentPhotos,
      image: images,
      experimentName: experiments.name,
      modelVersionId: experiments.modelVersionId,
      modelId: modelVersions.modelId,
      round: experimentRounds,
      detection: detections.document,
      failure: detectionFailures.document,
      label: labels.document,
    })
    .from(experimentPhotos)
    .innerJoin(experiments, eq(experiments.id, experimentPhotos.experimentId))
    .innerJoin(modelVersions, eq(modelVersions.id, experiments.modelVersionId))
    .innerJoin(images, eq(images.id, experimentPhotos.imageId))
    .leftJoin(
      labels,
      and(
        eq(labels.imageId, experimentPhotos.imageId),
        eq(labels.modelId, modelVersions.modelId),
      ),
    )
    .innerJoin(
      experimentRounds,
      and(
        eq(experimentRounds.experimentId, experimentPhotos.experimentId),
        eq(experimentRounds.id, experimentPhotos.roundId),
      ),
    )
    .leftJoin(
      detections,
      and(
        eq(detections.imageId, experimentPhotos.imageId),
        eq(detections.modelVersionId, experiments.modelVersionId),
      ),
    )
    .leftJoin(
      detectionFailures,
      and(
        eq(detectionFailures.imageId, experimentPhotos.imageId),
        eq(detectionFailures.modelVersionId, experiments.modelVersionId),
      ),
    )
    .where(atPhoto(ref));
  if (!row) return null;
  return {
    ref,
    experimentName: row.experimentName,
    round: toRound(row.round),
    digest: row.image.id,
    filename: row.photo.filename,
    width: row.image.width,
    height: row.image.height,
    blobKey: imageBlobKey(row.image.id),
    modelVersionId: row.modelVersionId,
    modelId: row.modelId,
    detection: row.detection,
    failure: row.failure,
    label: row.label,
  };
}

/** Forgets the failure under the experiment's version so a worker tries again. */
export async function retryExperimentDetection(ref: PhotoRef): Promise<void> {
  await transaction(async (tx) => {
    const photo = await readExperimentPhoto(ref, tx);
    if (!photo) {
      throw new ExperimentPhotoNotFoundError(
        `No photo of dish ${ref.dish} in round ${ref.round} of ${ref.experiment}`,
      );
    }
    await clearDetectionFailure(
      { digest: photo.digest, versionId: photo.modelVersionId },
      tx,
    );
  });
}

import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";

import { database, transaction, type Executor } from "../db/client";
import {
  experimentDishes,
  experimentPhotos,
  experimentRounds,
  experiments,
  images,
  inferenceOutcomes,
  labels,
  modelVersions,
} from "../db/schema";
import type {
  ExperimentDishSeries,
  ExperimentGrid,
  ExperimentPhoto,
  ExperimentSummary,
  PhotoCell,
} from "../experiments/contracts";
import {
  ExperimentPhotoAlreadyUsedError,
  ExperimentPhotoNotFoundError,
  ImagesNotStoredError,
  RoundNotFoundError,
  RoundRejectedError,
} from "../experiments/errors";
import {
  compareDishLabels,
  dishLabel,
  roundRefSchema,
  roundRequestSchema,
  roundUpdateSchema,
  type DishRef,
  type Experiment,
  type ExperimentRound,
  type PhotoRef,
  type PhotoState,
  type RoundResult,
} from "../experiments/schema";
import type { Tally } from "../models/readings";
import type { Model, ModelVersion } from "../models/schema";
import { imageBlobKey } from "./blobs";
import { clearDetectionFailure } from "./inference-outcomes";
import {
  listDishes,
  listRounds,
  listTreatments,
  lockExperiment,
  readExperimentRecord,
  toExperiment,
  toRound,
} from "./experiment-records";
import { lockImage } from "./image-lock";
import { readModel, readModelVersion, toModelVersion } from "./model-registry";

/** Instances per class of one stored document, tallied in the database. */
function tallyOf(document: SQL | AnyColumn) {
  return sql<Tally | null>`(select jsonb_object_agg(instance.class, instance.total) from (select item->>'class' as class, count(*) as total from jsonb_array_elements(${document}->'instances') as item group by 1) as instance)`;
}

/** Grid rows never load outcome documents merely to show readings. */
function photoGridQuery(db: Executor) {
  return db
    .select({
      photo: experimentPhotos,
      outcomeStatus: inferenceOutcomes.status,
      observed: tallyOf(inferenceOutcomes.document),
      reviewed: tallyOf(labels.document),
      reviewComplete: sql<boolean | null>`${labels.status} = 'complete'`,
      error: sql<string | null>`${inferenceOutcomes.document}->>'error'`,
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
      inferenceOutcomes,
      and(
        eq(inferenceOutcomes.imageId, experimentPhotos.imageId),
        eq(inferenceOutcomes.modelVersionId, experiments.modelVersionId),
      ),
    );
}

type PhotoGridRow = Awaited<ReturnType<typeof photoGridQuery>>[number];

function toCell(row: PhotoGridRow): PhotoCell {
  const state: PhotoState =
    row.outcomeStatus === "succeeded"
      ? "observed"
      : row.outcomeStatus === "failed"
        ? "failed"
        : "pending";
  return {
    dish: row.photo.dishLabel,
    round: row.photo.roundId,
    digest: row.photo.imageId,
    filename: row.photo.filename,
    state,
    observed: row.outcomeStatus === "succeeded" ? (row.observed ?? {}) : null,
    reviewed: row.reviewComplete ? (row.reviewed ?? {}) : null,
    error: row.error,
  };
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
  const experiment = await readExperimentRecord(experimentId, db);
  if (!experiment) return null;
  const { model, version } = await readTask(experiment, db);
  const [treatments, dishes, rounds, photos] = await Promise.all([
    listTreatments(experimentId, db),
    listDishes(experimentId, db),
    listRounds(experimentId, db),
    listCells(experimentId, db),
  ]);
  return { experiment, model, version, treatments, dishes, rounds, photos };
}

async function readTask(
  experiment: Experiment,
  db: Executor,
): Promise<{ model: Model; version: ModelVersion }> {
  const version = await readModelVersion(experiment.modelVersionId, db);
  if (!version) {
    throw new Error(`Unknown model version: ${experiment.modelVersionId}`);
  }
  const model = await readModel(version.modelId, db);
  if (!model) throw new Error(`Unknown model: ${version.modelId}`);
  return { model, version };
}

/**
 * The series of one dish, showing `roundId` when given and otherwise the
 * newest round that photographed the dish. A round that did not is not a page.
 */
export async function readExperimentDish(
  ref: DishRef,
  roundId?: string,
): Promise<ExperimentDishSeries | null> {
  const db = await database();
  const experiment = await readExperimentRecord(ref.experiment, db);
  if (!experiment) return null;
  const roster = await listDishes(ref.experiment, db);
  const position = roster.findIndex((dish) => dish.label === ref.dish);
  if (position < 0) return null;
  const dish = roster[position]!;
  const [{ model, version }, treatments, rounds, cells] = await Promise.all([
    readTask(experiment, db),
    listTreatments(ref.experiment, db),
    listRounds(ref.experiment, db),
    photoGridQuery(db)
      .where(
        and(
          eq(experimentPhotos.experimentId, ref.experiment),
          eq(experimentPhotos.dishLabel, ref.dish),
        ),
      )
      .then((rows) => rows.map(toCell)),
  ]);
  const byRound = new Map(cells.map((cell) => [cell.round, cell]));
  const series = rounds.map((round) => ({
    round,
    photo: byRound.get(round.id) ?? null,
  }));
  const chosen =
    roundId === undefined
      ? [...series].reverse().find((item) => item.photo !== null)
      : series.find((item) => item.round.id === roundId && item.photo);
  if (roundId !== undefined && !chosen) return null;
  const shown = chosen
    ? await readExperimentPhoto({ ...ref, round: chosen.round.id }, db)
    : null;
  return {
    experiment,
    model,
    version,
    dish,
    treatment:
      treatments.find((treatment) => treatment.id === dish.treatment) ?? null,
    previous: roster[position - 1]?.label ?? null,
    next: roster[position + 1]?.label ?? null,
    rounds: series,
    shown,
  };
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
        pending: sql<number>`count(*) filter (where ${inferenceOutcomes.imageId} is null)`,
        failed: sql<number>`count(*) filter (where ${inferenceOutcomes.status} = 'failed')`,
        observed: sql<number>`count(*) filter (where ${inferenceOutcomes.status} = 'succeeded')`,
      })
      .from(experimentPhotos)
      .innerJoin(experiments, eq(experiments.id, experimentPhotos.experimentId))
      .leftJoin(
        inferenceOutcomes,
        and(
          eq(inferenceOutcomes.imageId, experimentPhotos.imageId),
          eq(inferenceOutcomes.modelVersionId, experiments.modelVersionId),
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
        observed: Number(row.observed),
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
      observed: 0,
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
    await lockExperiment(experimentId, tx);

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

function atRound(experimentId: string, roundId: string) {
  return and(
    eq(experimentRounds.experimentId, experimentId),
    eq(experimentRounds.id, roundId),
  );
}

/** Renames or redates one round; its photographs stay where they are. */
export async function updateRound(value: unknown): Promise<ExperimentRound> {
  const {
    experiment: experimentId,
    round: roundId,
    label,
    capturedAt,
  } = roundUpdateSchema.parse(value);
  return transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    const taken = (await listRounds(experimentId, tx)).find(
      (round) => round.label === label && round.id !== roundId,
    );
    if (taken) throw new RoundRejectedError(`Round ${label} already exists`);
    const [row] = await tx
      .update(experimentRounds)
      .set({ label, capturedAt: new Date(capturedAt) })
      .where(atRound(experimentId, roundId))
      .returning();
    if (!row) throw new RoundNotFoundError(`Unknown round: ${roundId}`);
    return toRound(row);
  });
}

/**
 * Forgets one occasion and the use it made of photographs. The dishes it
 * named remain the roster, and so does an experiment with no rounds left.
 */
export async function deleteRound(value: unknown): Promise<void> {
  const { experiment: experimentId, round: roundId } =
    roundRefSchema.parse(value);
  await transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    const [row] = await tx
      .delete(experimentRounds)
      .where(atRound(experimentId, roundId))
      .returning({ id: experimentRounds.id });
    if (!row) throw new RoundNotFoundError(`Unknown round: ${roundId}`);
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
      outcome: inferenceOutcomes.document,
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
      inferenceOutcomes,
      and(
        eq(inferenceOutcomes.imageId, experimentPhotos.imageId),
        eq(inferenceOutcomes.modelVersionId, experiments.modelVersionId),
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
    detection: row.outcome && "instances" in row.outcome ? row.outcome : null,
    failure: row.outcome && "error" in row.outcome ? row.outcome : null,
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

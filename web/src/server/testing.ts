import { createHash } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";

import { makeResult } from "../annotation/testing";
import {
  userAccountSchema,
  type UserAccount,
  type UserRole,
} from "../auth/schema";
import type { Dataset } from "../datasets/schema";
import type { DetectionResult } from "../detection/schema";
import type { Experiment, ObservationImageRef } from "../experiments/schema";
import type { RuntimeDescriptor } from "../inference/schema";
import type { Model, ModelVersion } from "../models/schema";
import type { InferenceWorkerHeartbeat } from "../inference/workers";
import { canonicalize } from "./image-ingest";
import { addExperimentObservationImages } from "./datasets";
import {
  addObservationUnits,
  addTreatment,
  createExperiment,
} from "./experiment-design";
import { assignObservationImages } from "./experiment-observation-images";
import { addObservation } from "./experiment-observations";
import { auth } from "./auth";
import { storeImage } from "./image-store";
import {
  createAnnotationFromDetection,
  readAnnotation,
  updateAnnotation,
} from "./annotations";
import { recordInferenceOutcome } from "./inference-outcomes";
import { SEED_DETECTOR_BASELINE_VERSION_ID } from "../models/builtins";
import { readModelVersion, registerModelVersion } from "./model-registry";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { database, transaction } from "../db/client";
import { registerModel as registerDatabaseModel } from "../db/registry";
import {
  datasetSnapshots,
  datasets,
  experimentObservationImages,
  trainingRuns,
} from "../db/schema";

export const TEST_RUNTIME: RuntimeDescriptor = {
  adapter: "traditional",
  fingerprint: "b".repeat(64),
};

export const ULTRALYTICS_RUNTIME: RuntimeDescriptor = {
  adapter: "ultralytics",
  fingerprint: "e".repeat(64),
};

export async function registerTestModel(model: Model): Promise<Model> {
  return registerDatabaseModel(model, await database());
}

/** The builtin seed detector every deployment starts with. */
export async function baselineVersion(): Promise<ModelVersion> {
  const version = await readModelVersion(SEED_DETECTOR_BASELINE_VERSION_ID);
  if (!version) throw new Error("builtin models are not registered");
  return version;
}

/** Registers a trained version of `modelId`, as a training run would publish it. */
export async function registerTrainedVersion(
  modelId: string,
  slug = "yolo-v1",
): Promise<ModelVersion> {
  const datasetId = `${modelId}.${slug}.dataset`;
  const snapshotId = `${modelId}.${slug}.snapshot`;
  const runId = `${modelId}.${slug}.run`;
  const value: ModelVersion = {
    schemaVersion: 1,
    id: `${modelId}.${slug}`,
    modelId,
    name: `YOLO ${slug}`,
    createdAt: "2026-08-27T02:00:00.000Z",
    source: {
      kind: "training_run",
      trainingRunId: runId,
      trainingAttempt: 1,
      datasetSnapshotId: snapshotId,
    },
    artifact: {
      kind: "ultralytics",
      digest: createHash("sha256").update(`${modelId}.${slug}`).digest("hex"),
      weights: { digest: "c".repeat(64), bytes: 10 },
      inference: {
        confidence: 0.4,
        imageSize: 768,
        maxDetections: 500,
        endToEnd: false,
      },
      validation: {
        precision: 0.6,
        recall: 0.5,
        map50: 0.8,
        map50To95: 0.4,
        fitness: 0.44,
      },
      training: YOLO26_SEED_SMALL_RECIPE,
    },
  };
  return transaction(async (tx) => {
    await tx
      .insert(datasets)
      .values({ id: datasetId, modelId, createdAt: new Date() })
      .onConflictDoNothing();
    await tx
      .insert(datasetSnapshots)
      .values({ id: snapshotId, datasetId, modelId, createdAt: new Date() })
      .onConflictDoNothing();
    await tx
      .insert(trainingRuns)
      .values({
        id: runId,
        modelId,
        datasetSnapshotId: snapshotId,
        createdAt: new Date(value.createdAt),
        attempt: 1,
        recipe: YOLO26_SEED_SMALL_RECIPE,
        status: "queued",
      })
      .onConflictDoNothing();
    const version = await registerModelVersion(value, tx);
    await tx
      .update(trainingRuns)
      .set({ status: "succeeded", modelVersionId: version.id })
      .where(eq(trainingRuns.id, runId));
    return version;
  });
}

/** A heartbeat from a worker that executes only `TEST_RUNTIME`. */
export function testHeartbeat(
  workerId: string,
  current: string | null = null,
): InferenceWorkerHeartbeat {
  return {
    workerId,
    startedAt: "2026-08-27T00:00:00.000Z",
    runtimes: [TEST_RUNTIME],
    loaded: null,
    current,
  };
}

/** Fixture images are grids of flat blocks so lossy encoding keeps them distinct. */
const FIXTURE_BLOCKS = 8;
const FIXTURE_BLOCK_PIXELS = 8;
export const FIXTURE_EDGE = FIXTURE_BLOCKS * FIXTURE_BLOCK_PIXELS;

/** A source image whose pixels follow from `content`. */
export async function imageBytes(
  content: string,
  format: "png" | "jpeg" | "tiff" = "png",
): Promise<Uint8Array<ArrayBuffer>> {
  const seed = createHash("sha256").update(content).digest();
  const pixels = Buffer.alloc(FIXTURE_EDGE * FIXTURE_EDGE * 3);
  for (let y = 0; y < FIXTURE_EDGE; y += 1) {
    for (let x = 0; x < FIXTURE_EDGE; x += 1) {
      const block =
        Math.floor(y / FIXTURE_BLOCK_PIXELS) * FIXTURE_BLOCKS +
        Math.floor(x / FIXTURE_BLOCK_PIXELS);
      const offset = (y * FIXTURE_EDGE + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = seed[(block * 3 + channel) % seed.length]!;
      }
    }
  }
  const image = sharp(pixels, {
    raw: { width: FIXTURE_EDGE, height: FIXTURE_EDGE, channels: 3 },
  });
  const encoded =
    format === "png"
      ? image.png()
      : format === "jpeg"
        ? image.jpeg()
        : image.tiff();
  const encodedBytes = await encoded.toBuffer();
  const bytes = new Uint8Array(new ArrayBuffer(encodedBytes.byteLength));
  bytes.set(encodedBytes);
  return bytes;
}

/** The digest `imageBytes(content)` is stored under once it is canonicalised. */
export async function imageDigest(content: string): Promise<string> {
  return (await canonicalize(await imageBytes(content))).digest;
}

/** Stores one deterministic source per text, returning the digests in order. */
export async function storeTexts(contents: string[]): Promise<string[]> {
  const digests = [];
  for (const content of contents) {
    digests.push((await storeImage(await imageBytes(content))).digest);
  }
  return digests;
}

export interface ObservedImages {
  experiment: Experiment;
  version: ModelVersion;
  /** In the order of `contents`. */
  digests: string[];
  /** In the order of `contents`. */
  images: ObservationImageRef[];
}

/**
 * Creates one observation unit per text and assigns an image to each in the
 * experiment's first observation.
 */
export async function observeImages(
  experimentName: string,
  contents: string[],
  version?: ModelVersion,
): Promise<ObservedImages> {
  const selectedVersion = version ?? (await baselineVersion());
  const experiment = await createExperiment({
    name: experimentName,
    plantMaterial: "",
    explantType: "",
    baseMedium: "",
    notes: "",
    inoculatedOn: "2026-08-01",
    modelVersionId: selectedVersion.id,
  });
  const treatment = await addTreatment({
    experiment: experiment.id,
    name: "Test",
    factor: null,
    note: "",
    replicates: 0,
  });
  const observationUnits = await addObservationUnits({
    experiment: experiment.id,
    treatment: treatment.id,
    codes: contents,
  });
  const byCode = new Map(
    observationUnits.map((observationUnit) => [
      observationUnit.code,
      observationUnit.id,
    ]),
  );
  const digests = await storeTexts(contents);
  const observation = await addObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
  });
  await assignObservationImages({
    experiment: experiment.id,
    observation: observation.id,
    images: contents.map((content, index) => ({
      observationUnit: byCode.get(content)!,
      digest: digests[index]!,
      filename: `${content}.jpg`,
    })),
  });
  const cells = await listExperimentObservationImages(experiment.id);
  return {
    experiment,
    version: selectedVersion,
    digests,
    images: contents.map((content) => ({
      experiment: experiment.id,
      observationImage: cells.get(byCode.get(content)!)!,
    })),
  };
}

/** Observation-image identifiers indexed by observation unit. */
async function listExperimentObservationImages(
  experimentId: string,
): Promise<Map<string, string>> {
  const rows = await (
    await database()
  )
    .select({
      observationUnitId: experimentObservationImages.observationUnitId,
      id: experimentObservationImages.id,
    })
    .from(experimentObservationImages)
    .where(eq(experimentObservationImages.experimentId, experimentId));
  return new Map(rows.map((row) => [row.observationUnitId, row.id]));
}

export interface SeededDataset extends ObservedImages {
  dataset: Dataset;
}

/** Creates observation images from the texts and adds them to the dataset. */
export async function uploadTexts(
  datasetId: string,
  contents: string[],
  version?: ModelVersion,
): Promise<SeededDataset> {
  const observation = await observeImages(
    `${datasetId} images`,
    contents,
    version,
  );
  const { dataset } = await addExperimentObservationImages({
    dataset: datasetId,
    images: observation.images,
  });
  return { ...observation, dataset };
}

/** A result `version` would produce for the image with these bytes. */
export async function resultFor(
  version: ModelVersion,
  content: string,
  runtime = TEST_RUNTIME,
): Promise<DetectionResult> {
  return {
    ...makeResult([{ id: 0, x: 10, y: 10 }], {
      digest: await imageDigest(content),
      dishRadius: FIXTURE_EDGE / 4,
      width: FIXTURE_EDGE,
      height: FIXTURE_EDGE,
    }),
    producer: {
      modelVersionId: version.id,
      artifactDigest: version.artifact.digest,
      runtime,
    },
  };
}

/**
 * Uploads the texts and completes a review of each, ready for training. A
 * review belongs to the image and the model, so texts already reviewed by an
 * earlier call keep the review they have.
 */
export async function reviewedDataset(
  datasetId: string,
  contents: string[],
): Promise<SeededDataset> {
  const seeded = await uploadTexts(datasetId, contents);
  for (const content of contents) {
    const ref = {
      digest: await imageDigest(content),
      modelId: seeded.version.modelId,
    };
    if (await readAnnotation(ref)) continue;
    const result = await resultFor(seeded.version, content);
    await recordInferenceOutcome(
      { digest: ref.digest, versionId: seeded.version.id },
      result,
      { runtimes: [result.producer.runtime] },
    );
    const started = await createAnnotationFromDetection(ref, seeded.version.id);
    await updateAnnotation(ref, { ...started, status: "complete" });
  }
  return seeded;
}

let accountSequence = 0;

export const TEST_PASSWORD = "correct-horse-battery";

/** A fresh signed-in account with `role`; the headers carry its session cookie. */
export async function signInAs(
  role: UserRole,
): Promise<{ user: UserAccount; headers: Headers }> {
  accountSequence += 1;
  const email = `${role}-${accountSequence}@test.invalid`;
  const instance = await auth();
  const { user } = await instance.api.createUser({
    body: {
      email,
      password: TEST_PASSWORD,
      name: `${role} ${accountSequence}`,
      role,
    },
  });
  return {
    user: userAccountSchema.parse({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned ?? false,
      createdAt: user.createdAt.toISOString(),
    }),
    headers: await sessionHeaders(email, TEST_PASSWORD),
  };
}

/** Signs in with the password and returns headers carrying the session cookie. */
export async function sessionHeaders(
  email: string,
  password: string,
): Promise<Headers> {
  const response = await (
    await auth()
  ).api.signInEmail({ body: { email, password }, asResponse: true });
  if (!response.ok) {
    throw new Error(`Sign-in refused: ${response.status}`);
  }
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";", 1)[0]!)
    .join("; ");
  return new Headers({ cookie });
}

/** Headers presenting `secret` as an API key. */
export function apiKeyHeaders(secret: string): Headers {
  return new Headers({ authorization: `Bearer ${secret}` });
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export interface McpAuthorization {
  clientId: string;
  accessToken: string;
}

/**
 * Runs the authorization flow an MCP client runs against the loopback auth
 * server: registers a public client, sends the signed-in browser through
 * authorize and consent, and exchanges the code with PKCE for an access
 * token bound to the MCP resource.
 */
export async function authorizeMcpClient(
  session: Headers,
  clientName = "Test MCP client",
): Promise<McpAuthorization> {
  const base = `${process.env.BETTER_AUTH_URL}/api/auth`;
  const redirectUri = "http://127.0.0.1/callback";
  const registration = await fetch(`${base}/oauth2/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      application_type: "native",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  if (!registration.ok) {
    throw new Error(
      `Client registration refused: ${registration.status} ${await registration.text()}`,
    );
  }
  const { client_id: clientId } = (await registration.json()) as {
    client_id: string;
  };

  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const resource = `${process.env.BETTER_AUTH_URL}/api/mcp`;
  const authorize = await fetch(
    `${base}/oauth2/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state: "state-1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
    })}`,
    { headers: session, redirect: "manual" },
  );
  const consentLocation = authorize.headers.get("location");
  if (!consentLocation?.includes("/consent?")) {
    throw new Error(
      `Authorize did not ask for consent: ${authorize.status} ${consentLocation ?? (await authorize.text())}`,
    );
  }
  const consent = await fetch(`${base}/oauth2/consent`, {
    method: "POST",
    headers: {
      ...Object.fromEntries(session),
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      accept: true,
      oauth_query: new URL(consentLocation, base).search.slice(1),
    }),
  });
  if (!consent.ok) {
    throw new Error(
      `Consent refused: ${consent.status} ${await consent.text()}`,
    );
  }
  const { url } = (await consent.json()) as { url: string };
  const code = new URL(url).searchParams.get("code");
  if (!code) throw new Error(`No authorization code in ${url}`);

  const token = await fetch(`${base}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    }),
  });
  if (!token.ok) {
    throw new Error(
      `Token exchange refused: ${token.status} ${await token.text()}`,
    );
  }
  const { access_token: accessToken } = (await token.json()) as {
    access_token: string;
  };
  return { clientId, accessToken };
}

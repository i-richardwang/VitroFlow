import { expect, test } from "bun:test";

import {
  INFERENCE_LEASE_SECONDS,
  InferenceClaimRejectedError,
  claimInferenceAssignment,
  completeInferenceClaim,
  releaseInferenceClaim,
  renewInferenceClaim,
} from "./jobs";
import {
  observeImages,
  observeImagesForModel,
  recordTestHeartbeat,
  registerTrainedVersion,
  snapshotImages,
  testHeartbeat,
  traditionalVersion,
  ULTRALYTICS_RUNTIME,
} from "../testing/fixtures";
import { createModel, setCurrentVersion } from "../models/public";

function targetOf(
  assignment: NonNullable<Awaited<ReturnType<typeof claimInferenceAssignment>>>,
) {
  return {
    versionId: assignment.manifest.modelVersionId,
    digest: assignment.image,
  };
}

test("inference claims are exclusive and expired ownership is fenced", async () => {
  await observeImages("claim-a", ["claim-a"]);
  await observeImages("claim-b", ["claim-b"]);
  const runtimes = [
    ...testHeartbeat("claim-runtime").runtimes,
    ULTRALYTICS_RUNTIME,
  ];
  const first = await recordTestHeartbeat({
    ...testHeartbeat("claim-worker-a"),
    runtimes,
  });
  const second = await recordTestHeartbeat({
    ...testHeartbeat("claim-worker-b"),
    runtimes,
  });
  const claimedAt = new Date("2026-09-03T12:00:00.000Z");
  const [left, right] = await Promise.all([
    claimInferenceAssignment(first, claimedAt),
    claimInferenceAssignment(second, claimedAt),
  ]);
  expect(left).not.toBeNull();
  expect(right).not.toBeNull();
  expect(targetOf(left!)).not.toEqual(targetOf(right!));

  const expiredAt = new Date(
    claimedAt.getTime() + INFERENCE_LEASE_SECONDS * 1000 + 1,
  );
  await expect(
    completeInferenceClaim(targetOf(left!), null as never, first, expiredAt),
  ).rejects.toBeInstanceOf(InferenceClaimRejectedError);
  let reclaimed = null;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const candidate = await claimInferenceAssignment(second, expiredAt);
    if (!candidate) break;
    if (
      candidate.image === left!.image &&
      candidate.manifest.modelVersionId === left!.manifest.modelVersionId
    ) {
      reclaimed = candidate;
      break;
    }
  }
  expect(reclaimed).not.toBeNull();
  await expect(
    completeInferenceClaim(targetOf(left!), null as never, first),
  ).rejects.toBeInstanceOf(InferenceClaimRejectedError);
});

test("a restarted worker's claims are free at once, and fenced", async () => {
  await observeImages("claim-restart", ["claim-restart"]);
  const before = await recordTestHeartbeat(
    testHeartbeat("claim-restart-worker"),
  );
  const claimedAt = new Date("2026-09-03T12:00:00.000Z");
  const held = await claimInferenceAssignment(before, claimedAt);
  expect(held).not.toBeNull();
  const after = await recordTestHeartbeat({
    ...testHeartbeat("claim-restart-worker"),
    sessionId: "session-claim-restart-worker-new",
    startedAt: "2026-08-28T00:00:00.000Z",
  });
  let reclaimed = null;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const candidate = await claimInferenceAssignment(after, claimedAt);
    if (!candidate) break;
    if (
      candidate.image === held!.image &&
      candidate.manifest.modelVersionId === held!.manifest.modelVersionId
    ) {
      reclaimed = candidate;
      break;
    }
  }
  expect(reclaimed).not.toBeNull();
  await expect(
    renewInferenceClaim(targetOf(held!), before, claimedAt),
  ).rejects.toBeInstanceOf(InferenceClaimRejectedError);
});

test("only a live owner can renew an inference claim", async () => {
  await observeImages("claim-renew", ["claim-renew"]);
  const worker = await recordTestHeartbeat(testHeartbeat("claim-renew-worker"));
  const claimedAt = new Date("2026-09-03T12:00:00.000Z");
  const assignment = await claimInferenceAssignment(worker, claimedAt);
  expect(assignment).not.toBeNull();
  const renewedAt = new Date(
    claimedAt.getTime() + (INFERENCE_LEASE_SECONDS * 1000) / 2,
  );
  const renewed = await renewInferenceClaim(
    targetOf(assignment!),
    worker,
    renewedAt,
  );
  expect(renewed.leaseExpiresAt).toBe(
    new Date(
      renewedAt.getTime() + INFERENCE_LEASE_SECONDS * 1000,
    ).toISOString(),
  );
  await expect(
    renewInferenceClaim(
      targetOf(assignment!),
      worker,
      new Date(renewedAt.getTime() + INFERENCE_LEASE_SECONDS * 1000 + 1),
    ),
  ).rejects.toBeInstanceOf(InferenceClaimRejectedError);
});

test("only the owner can give a claim back, and it is claimable at once", async () => {
  await observeImages("claim-release", ["claim-release"]);
  const owner = await recordTestHeartbeat(testHeartbeat("claim-release-a"));
  const other = await recordTestHeartbeat(testHeartbeat("claim-release-b"));
  const claimedAt = new Date("2026-09-03T12:00:00.000Z");
  const held = await claimInferenceAssignment(owner, claimedAt);
  expect(held).not.toBeNull();

  await releaseInferenceClaim(targetOf(held!), other, claimedAt);
  await renewInferenceClaim(targetOf(held!), owner, claimedAt);

  await releaseInferenceClaim(targetOf(held!), owner, claimedAt);
  await expect(
    renewInferenceClaim(targetOf(held!), owner, claimedAt),
  ).rejects.toBeInstanceOf(InferenceClaimRejectedError);
  let reclaimed = false;
  for (let attempt = 0; attempt < 500 && !reclaimed; attempt += 1) {
    const candidate = await claimInferenceAssignment(other, claimedAt);
    if (!candidate) break;
    reclaimed =
      candidate.image === held!.image &&
      candidate.manifest.modelVersionId === held!.manifest.modelVersionId;
  }
  expect(reclaimed).toBe(true);
});

test("a model with no version demands no work of any worker", async () => {
  const model = await createModel({
    id: "unclaimable-detector",
    name: "Unclaimable detector",
    classes: ["germinated"],
  });
  const { digests } = await observeImagesForModel(
    "unclaimable",
    ["unclaimable"],
    model.id,
  );
  const worker = await recordTestHeartbeat({
    ...testHeartbeat("unclaimable-worker"),
    runtimes: [
      ...testHeartbeat("unclaimable-worker").runtimes,
      ULTRALYTICS_RUNTIME,
    ],
  });
  const at = new Date("2026-09-04T12:00:00.000Z");
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const candidate = await claimInferenceAssignment(worker, at);
    if (!candidate) break;
    expect(candidate.image).not.toBe(digests[0]);
  }
});

test("a candidate is compared with the current version on its held-out images alone, until it is current", async () => {
  const baseline = await traditionalVersion("held-out-detector", "held-out-v1");
  const candidate = await registerTrainedVersion(
    "held-out-detector",
    "held-out-v2",
  );
  const [first, second] = await snapshotImages(candidate, [
    { content: "held-out-a", split: "val", reviewed: { ungerminated: 1 } },
    { content: "held-out-b", split: "val", reviewed: { ungerminated: 2 } },
    { content: "held-out-c", split: "train", reviewed: { ungerminated: 3 } },
  ]);
  const worker = await recordTestHeartbeat({
    ...testHeartbeat("held-out-worker"),
    runtimes: [
      ...testHeartbeat("held-out-worker").runtimes,
      ULTRALYTICS_RUNTIME,
    ],
  });
  const claimedFor = async (at: Date) => {
    const pairs: string[] = [];
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const claimed = await claimInferenceAssignment(worker, at);
      if (!claimed) break;
      const { modelVersionId } = claimed.manifest;
      if ([baseline.id, candidate.id].includes(modelVersionId)) {
        pairs.push(`${modelVersionId}:${claimed.image}`);
      }
    }
    return pairs.sort();
  };

  expect(await claimedFor(new Date("2026-09-05T12:00:00.000Z"))).toEqual(
    [
      `${baseline.id}:${first}`,
      `${baseline.id}:${second}`,
      `${candidate.id}:${first}`,
      `${candidate.id}:${second}`,
    ].sort(),
  );

  await setCurrentVersion({ model: candidate.modelId, version: candidate.id });
  expect(await claimedFor(new Date("2026-09-06T12:00:00.000Z"))).toEqual([]);
});

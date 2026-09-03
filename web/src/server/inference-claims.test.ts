import { expect, test } from "bun:test";

import {
  INFERENCE_LEASE_SECONDS,
  InferenceClaimRejectedError,
  claimInferenceAssignment,
  completeInferenceClaim,
  renewInferenceClaim,
} from "./inference-outcomes";
import { recordInferenceHeartbeat } from "./inference-worker-store";
import { ULTRALYTICS_RUNTIME, observeImages, testHeartbeat } from "./testing";

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
  const first = await recordInferenceHeartbeat({
    ...testHeartbeat("claim-worker-a"),
    runtimes,
  });
  const second = await recordInferenceHeartbeat({
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

test("only a live owner can renew an inference claim", async () => {
  await observeImages("claim-renew", ["claim-renew"]);
  const worker = await recordInferenceHeartbeat(
    testHeartbeat("claim-renew-worker"),
  );
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

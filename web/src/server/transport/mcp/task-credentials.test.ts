import { expect, test } from "bun:test";
import { issueTaskToken, verifyTaskToken } from "./task-credentials";

test("task credentials authenticate claims, expire and reject malformed tokens", () => {
  const principal = {
    kind: "task" as const,
    runId: crypto.randomUUID(),
    taskId: "run/tile-000-000",
    attemptId: crypto.randomUUID(),
    expiresAt: Date.now() + 60000,
  };
  const token = issueTaskToken(principal);
  expect(verifyTaskToken(token)).toEqual(principal);
  const [payload, signature] = token.slice(5).split(".");
  const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
  const changed = Buffer.from(
    JSON.stringify({ ...claims, taskId: "other/tile-000-000" }),
  ).toString("base64url");
  expect(verifyTaskToken(`vfat_${changed}.${signature}`)).toBeNull();
  expect(
    verifyTaskToken(
      issueTaskToken({ ...principal, expiresAt: Date.now() - 1 }),
    ),
  ).toBeNull();
  for (const malformed of [
    "",
    "vfat_",
    "vfat_a.b",
    `${token}.extra`,
    `${token}forged`,
  ]) {
    expect(verifyTaskToken(malformed)).toBeNull();
  }
});

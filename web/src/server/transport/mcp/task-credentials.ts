import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { deploymentEndpoint } from "../../infra/deployment";
import type { AnnotationPrincipal } from "../../../domain/annotation-runs/access";

const PREFIX = "vfat_";
const claimsSchema = z.strictObject({
  kind: z.literal("task"),
  runId: z.string().min(1),
  taskId: z.string().min(1),
  attemptId: z.string().uuid(),
  expiresAt: z.number().int().positive(),
  audience: z.string(),
});
function signature(payload: string): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required");
  return createHmac("sha256", secret)
    .update(`annotation-task:${payload}`)
    .digest();
}
export function isTaskToken(token: string): boolean {
  return token.startsWith(PREFIX);
}
export function issueTaskToken(
  principal: Extract<AnnotationPrincipal, { kind: "task" }>,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      ...principal,
      audience: deploymentEndpoint().mcpResource,
    }),
  ).toString("base64url");
  return `${PREFIX}${payload}.${signature(payload).toString("base64url")}`;
}
export function verifyTaskToken(
  token: string,
): Extract<AnnotationPrincipal, { kind: "task" }> | null {
  if (!isTaskToken(token) || token.length > 4096) return null;
  const parts = token.slice(PREFIX.length).split(".");
  if (parts.length !== 2) return null;
  const [payload, signed] = parts as [string, string];
  try {
    const actual = Buffer.from(signed, "base64url"),
      expected = signature(payload);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return null;
    const { audience, ...claims } = claimsSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString()),
    );
    if (
      audience !== deploymentEndpoint().mcpResource ||
      claims.expiresAt <= Date.now()
    )
      return null;
    return claims;
  } catch {
    return null;
  }
}

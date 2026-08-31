import { describe, expect, test } from "bun:test";

import { errorMessage, performAction } from "./useAsyncAction";

describe("performAction", () => {
  test("preserves success and failure as different results", async () => {
    await expect(performAction(async () => 7)).resolves.toEqual({
      ok: true,
      value: 7,
    });
    const error = new Error("not saved");
    await expect(
      performAction(async () => {
        throw error;
      }),
    ).resolves.toEqual({ ok: false, error });
  });

  test("formats unknown failures", () => {
    expect(errorMessage(new Error("broken"))).toBe("broken");
    expect(errorMessage("offline")).toBe("offline");
  });
});

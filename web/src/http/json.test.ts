import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { parseHttpJson } from "./json";

const responseSchema = z.strictObject({ value: z.number().int() });

describe("parseHttpJson", () => {
  test("parses a successful response through its runtime schema", () => {
    expect(parseHttpJson('{"value":3}', 200, responseSchema)).toEqual({
      value: 3,
    });
  });

  test("rejects malformed success and structured server failures", () => {
    expect(() => parseHttpJson('{"value":"3"}', 200, responseSchema)).toThrow();
    expect(() =>
      parseHttpJson('{"error":"observation rejected"}', 422, responseSchema),
    ).toThrow("observation rejected");
  });
});

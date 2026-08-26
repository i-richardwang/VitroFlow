import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { prelabelSchema } from "./schema";

const CONTRACT_FIXTURE = path.resolve(
  import.meta.dir,
  "../../../tests/fixtures/contracts/prelabel.json",
);

describe("prelabel contract", () => {
  test("loads the shared box-first contract fixture", () => {
    const prelabel = prelabelSchema.parse(
      JSON.parse(fs.readFileSync(CONTRACT_FIXTURE, "utf-8")),
    );
    if ("error" in prelabel) {
      throw new Error("unexpected failure fixture");
    }

    expect(prelabel.producer.version_id).toBe("traditional-test");
    expect(prelabel.instances[0].bbox).toEqual({
      x: 10,
      y: 20,
      width: 8,
      height: 6,
    });
  });

  test("rejects boxes outside the image", () => {
    const document = JSON.parse(fs.readFileSync(CONTRACT_FIXTURE, "utf-8"));
    document.instances[0].bbox.x = 99;

    expect(prelabelSchema.safeParse(document).success).toBe(false);
  });
});

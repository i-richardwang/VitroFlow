import { describe, expect, test } from "bun:test";

import { MAX_IMAGE_BYTES, sourceImageFileError } from "./canonical";

describe("source image admission", () => {
  test("accepts the formats the server canonicalizes", () => {
    for (const name of ["a.jpg", "a.JPEG", "a.png", "a.tif", "a.TIFF"]) {
      expect(sourceImageFileError({ name, size: 1 })).toBeNull();
    }
  });

  test("rejects unsupported, empty, and oversized sources", () => {
    expect(sourceImageFileError({ name: "a.avif", size: 1 })).toMatch(
      /JPEG, PNG, or TIFF/,
    );
    expect(sourceImageFileError({ name: "a.jpg", size: 0 })).toMatch(/empty/);
    expect(
      sourceImageFileError({
        name: "a.jpg",
        size: MAX_IMAGE_BYTES + 1,
      }),
    ).toMatch(/64 MiB/);
  });
});

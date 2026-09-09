import { describe, expect, test } from "bun:test";

import { blobExists, putImmutableBlob } from "../infra/blobs/store";
import { imageBlobKey } from "../images/keys";

import { collectImages } from "../images/collection";
import { canonicalize } from "../images/ingest";
import { storeImage } from "../images/store";
import { imageBytes, observeImages } from "../testing/fixtures";

describe("collection", () => {
  /** A moment past the period an unclaimed image is kept for. */
  const later = () => new Date(Date.now() + 25 * 60 * 60 * 1000);

  test("keeps unclaimed bytes while an observation is still being submitted", async () => {
    const { digest } = await storeImage(await imageBytes("waiting"));
    expect(await collectImages()).not.toContain(digest);
    expect(await blobExists(imageBlobKey(digest))).toBe(true);
  });

  test("collects images no observation claimed", async () => {
    const { digest } = await storeImage(await imageBytes("abandoned"));
    expect(await collectImages(later())).toContain(digest);
    expect(await blobExists(imageBlobKey(digest))).toBe(false);
  });

  test("an observation keeps its images", async () => {
    const { digests } = await observeImages("kept images", ["kept"]);
    expect(await collectImages(later())).not.toContain(digests[0]);
    expect(await blobExists(imageBlobKey(digests[0]!))).toBe(true);
  });

  test("collects an immutable object whose Image transaction never committed", async () => {
    const orphan = await canonicalize(await imageBytes("orphan"));
    await putImmutableBlob(imageBlobKey(orphan.digest), orphan.bytes);

    expect(await collectImages()).toContain(orphan.digest);
    expect(await blobExists(imageBlobKey(orphan.digest))).toBe(false);
  });
});

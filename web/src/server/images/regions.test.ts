import { expect, test } from "bun:test";
import sharp from "sharp";
import { imageOverview, imageRegions } from "../../domain/images/regions";
import { createMemoryBlobStore } from "../infra/blobs/store";
import { imageBlobKey } from "./keys";
import { canonicalize } from "./ingest";
import { createImageRegionReader } from "./regions";

async function fixture() {
  const width = 1250,
    height = 830;
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++)
    pixels[i] = (i * 13 + Math.floor(i / (width * 3))) % 256;
  const source = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  const image = await canonicalize(source);
  const store = createMemoryBlobStore();
  await store.putImmutable(imageBlobKey(image.digest), image.bytes);
  let sourceReads = 0;
  const tracked = {
    read: async (key: string) => {
      if (key === imageBlobKey(image.digest)) sourceReads++;
      return store.read(key);
    },
    putImmutable: store.putImmutable,
  };
  return { image, store, tracked, sourceReads: () => sourceReads };
}

test("prepared evidence preserves source-pipeline pixels at edges, halos and display scales", async () => {
  const { image, tracked } = await fixture();
  const read = createImageRegionReader(tracked);
  for (const displayScale of [1, 2, 4]) {
    const layout = { coreSize: 512, halo: 32, displayScale };
    const overview = imageOverview(image);
    const expectedOverview = await sharp(image.bytes)
      .resize(overview.width, overview.height)
      .raw()
      .toBuffer();
    for (const { id, patch } of imageRegions(image, layout)) {
      const evidence = await read(image, layout, id);
      const expected = await sharp(image.bytes)
        .extract({
          left: patch.x,
          top: patch.y,
          width: patch.width,
          height: patch.height,
        })
        .resize(patch.width * displayScale, patch.height * displayScale, {
          kernel: "nearest",
        })
        .raw()
        .toBuffer();
      expect(await sharp(evidence.clean).raw().toBuffer()).toEqual(expected);
      expect(await sharp(evidence.overview.bytes).raw().toBuffer()).toEqual(
        expectedOverview,
      );
    }
  }
});

test("concurrent regions prepare the source once and a new reader reuses persisted assets", async () => {
  const { image, tracked, sourceReads } = await fixture();
  const layout = { coreSize: 512, halo: 32, displayScale: 1 };
  const regions = imageRegions(image, layout);
  const read = createImageRegionReader(tracked);
  const evidence = await Promise.all(
    regions.map(({ id }) => read(image, layout, id)),
  );
  expect(sourceReads()).toBe(1);
  const restarted = createImageRegionReader(tracked);
  expect((await restarted(image, layout, regions.at(-1)!.id)).clean).toEqual(
    evidence.at(-1)!.clean,
  );
  expect(sourceReads()).toBe(1);
  await restarted(image, { ...layout, halo: 48 }, regions[0]!.id);
  expect(sourceReads()).toBe(2);
});

test("partial preparation is reusable and failed work does not poison later requests", async () => {
  const { image, tracked, store, sourceReads } = await fixture();
  const layout = { coreSize: 512, halo: 32, displayScale: 1 };
  let fail = true;
  const read = createImageRegionReader({
    ...tracked,
    putImmutable: async (key, bytes) => {
      if (fail && key.endsWith("tile-000-001.png")) {
        fail = false;
        throw new Error("storage unavailable");
      }
      await tracked.putImmutable(key, bytes);
    },
  });
  await expect(read(image, layout, "tile-000-001")).rejects.toThrow(
    "storage unavailable",
  );
  expect(sourceReads()).toBe(1);
  const restarted = createImageRegionReader(tracked);
  await restarted(image, layout, "tile-000-000");
  expect(sourceReads()).toBe(1);
  await read(image, layout, "tile-000-001");
  expect(sourceReads()).toBe(2);
  await store.remove(imageBlobKey(image.digest));
  await createImageRegionReader(tracked)(image, layout, "tile-001-002");
  expect(sourceReads()).toBe(2);
});

test("scoped preparation produces only needed regions and can be reused or expanded", async () => {
  const { image, store, tracked, sourceReads } = await fixture();
  const layout = { coreSize: 512, halo: 32, displayScale: 1 };
  const scope = [{ x: 512, y: 0, width: 1, height: 1 }];
  const read = createImageRegionReader(tracked);
  const first = await read(image, layout, "tile-000-001", scope);
  expect((await store.list("image-regions/")).length).toBe(2);
  expect((await read(image, layout, "tile-000-001")).clean).toBe(first.clean);
  expect(sourceReads()).toBe(1);
  await expect(read(image, layout, "tile-000-000", scope)).rejects.toThrow(
    "does not exist",
  );
  const [second, third] = await Promise.all([
    read(image, layout, "tile-000-000", [{ x: 0, y: 0, width: 1, height: 1 }]),
    read(image, layout, "tile-001-002"),
  ]);
  expect(second.clean.byteLength).toBeGreaterThan(0);
  expect(third.clean.byteLength).toBeGreaterThan(0);
  expect(sourceReads()).toBe(3);
});

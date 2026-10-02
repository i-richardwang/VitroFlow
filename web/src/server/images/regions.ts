import sharp from "sharp";
import {
  imageOverview,
  imageRegions,
  type ImageFrame,
  type ImageRegionLayout,
  type ImageRectangle,
} from "../../domain/images/regions";
import { MAX_SOURCE_IMAGE_PIXELS } from "../../domain/images/canonical";
import { createSingleFlight } from "../../lib/async/work";
import { ByteCache } from "../../lib/cache/bytes";
import { canonicalJson } from "../../lib/json/canonical";
import { contentDigest } from "../infra/digest";
import {
  readBlob,
  putImmutableBlob,
  type BlobStore,
} from "../infra/blobs/store";
import { imageBlobKey, imageRegionsPrefix } from "./keys";
import { processImage } from "./processing";

export interface ImageRegionEvidence {
  key: string;
  clean: Buffer;
}

/** Persistent image evidence, shared across runs, models and connected clients. */
export function createImageEvidenceReader(
  store: Pick<BlobStore, "read" | "putImmutable">,
) {
  const cache = new ByteCache<Buffer>(32 * 1024 * 1024);
  const preparing = createSingleFlight<void>();
  const reading = createSingleFlight<Buffer | null>();

  async function read(key: string): Promise<Buffer | null> {
    const cached = cache.get(key);
    if (cached) return cached;
    return reading(key, async () => {
      const bytes = await store.read(key);
      if (!bytes) return null;
      const buffer = Buffer.from(bytes);
      cache.set(key, buffer);
      return buffer;
    });
  }
  async function write(key: string, bytes: Buffer): Promise<void> {
    await store.putImmutable(key, bytes);
    cache.set(key, bytes);
  }

  async function evidence(
    image: ImageFrame,
    layout: ImageRegionLayout,
    scope: readonly ImageRectangle[] | null,
    regionId: string | null,
  ): Promise<{ key: string; bytes: Buffer }> {
    const regions = imageRegions(image, layout, scope);
    if (regionId !== null && !regions.some((region) => region.id === regionId))
      throw new Error("Image region does not exist");
    const { coreSize, halo, displayScale } = layout;
    const recipe = contentDigest(
      canonicalJson({
        version: 1,
        coreSize,
        halo,
        displayScale,
        renderer: sharp.versions,
      }),
    );
    const prefix = `${imageRegionsPrefix(image.digest)}${recipe}/`;
    const key = `${prefix}${regionId ?? "overview"}.png`;
    const overviewKey = `${prefix}overview.png`;
    const overview = imageOverview(image);
    const existing = await read(key);
    if (existing) return { key, bytes: existing };

    const preparation = `${prefix}${contentDigest(canonicalJson(regions.map(({ id }) => id)))}`;
    await preparing(preparation, () =>
      processImage(async () => {
        if (await read(key)) return;
        const source = await store.read(imageBlobKey(image.digest));
        if (!source) throw new Error(`Missing image: ${image.digest}`);
        const { data, info } = await sharp(source, {
          limitInputPixels: MAX_SOURCE_IMAGE_PIXELS,
        })
          .raw()
          .toBuffer({ resolveWithObject: true });
        if (
          info.width !== image.width ||
          info.height !== image.height ||
          info.channels !== 3
        )
          throw new Error("Image pixels do not match the canonical frame");
        const pixels = () =>
          sharp(data, {
            raw: { width: info.width, height: info.height, channels: 3 },
          });
        await write(
          overviewKey,
          await pixels()
            .resize(overview.width, overview.height)
            .png()
            .toBuffer(),
        );
        for (const { id, patch } of regions) {
          const clean = await pixels()
            .extract({
              left: patch.x,
              top: patch.y,
              width: patch.width,
              height: patch.height,
            })
            .resize(patch.width * displayScale, patch.height * displayScale, {
              kernel: "nearest",
            })
            .png()
            .toBuffer();
          await write(`${prefix}${id}.png`, clean);
        }
      }),
    );
    const prepared = await read(key);
    if (!prepared) throw new Error("Prepared image region is missing");
    return { key, bytes: prepared };
  }

  return {
    async readRegion(
      image: ImageFrame,
      layout: ImageRegionLayout,
      regionId: string,
      scope: readonly ImageRectangle[] | null = null,
    ): Promise<ImageRegionEvidence> {
      const { key, bytes } = await evidence(image, layout, scope, regionId);
      return { key, clean: bytes };
    },
    async readOverview(
      image: ImageFrame,
      layout: ImageRegionLayout,
      scope: readonly ImageRectangle[] | null = null,
    ) {
      const { bytes } = await evidence(image, layout, scope, null);
      return { ...imageOverview(image), bytes };
    },
  };
}

const evidence = createImageEvidenceReader({
  read: readBlob,
  putImmutable: putImmutableBlob,
});
export const readImageRegion = evidence.readRegion;
export const readImageOverview = evidence.readOverview;

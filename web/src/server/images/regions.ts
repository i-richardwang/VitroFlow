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
  overview: { bytes: Buffer; width: number; height: number; scale: number };
}

/** Persistent image evidence, shared across runs, models and connected clients. */
export function createImageRegionReader(
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

  return async function readImageRegion(
    image: ImageFrame,
    layout: ImageRegionLayout,
    regionId: string,
    scope: readonly ImageRectangle[] | null = null,
  ): Promise<ImageRegionEvidence> {
    const regions = imageRegions(image, layout, scope);
    if (!regions.some((region) => region.id === regionId))
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
    const cleanKey = `${prefix}${regionId}.png`;
    const overviewKey = `${prefix}overview.png`;
    const overview = imageOverview(image);
    const evidence = async (): Promise<ImageRegionEvidence | null> => {
      const [clean, bytes] = await Promise.all([
        read(cleanKey),
        read(overviewKey),
      ]);
      return clean && bytes
        ? { key: cleanKey, clean, overview: { ...overview, bytes } }
        : null;
    };
    const existing = await evidence();
    if (existing) return existing;

    const preparation = `${prefix}${contentDigest(canonicalJson(regions.map(({ id }) => id)))}`;
    await preparing(preparation, () =>
      processImage(async () => {
        if (await evidence()) return;
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
    const prepared = await evidence();
    if (!prepared) throw new Error("Prepared image region is missing");
    return prepared;
  };
}

export const readImageRegion = createImageRegionReader({
  read: readBlob,
  putImmutable: putImmutableBlob,
});

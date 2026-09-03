import { storedZip } from "../archive/zip";
import { blobEntryName, manifestEntryName } from "../datasets/archive";
import { encodeDatasetManifest } from "../datasets/manifest";
import { imageBlobKey, requireBlob } from "./blobs";
import { readDatasetManifest } from "./dataset-transfer";

/**
 * The dataset as one archive: its manifest, then each image it names, read
 * from the store as the archive streams so that the response holds one
 * image at a time.
 */
export async function datasetArchive(
  datasetId: string,
): Promise<ReadableStream<Uint8Array> | null> {
  const manifest = await readDatasetManifest(datasetId);
  if (!manifest) return null;
  const manifestBytes = encodeDatasetManifest(manifest);
  return storedZip(
    (async function* () {
      yield {
        name: manifestEntryName(datasetId),
        bytes: manifestBytes,
      };
      for (const image of manifest.images) {
        yield {
          name: blobEntryName(image.digest),
          bytes: await requireBlob(imageBlobKey(image.digest)),
        };
      }
    })(),
  );
}

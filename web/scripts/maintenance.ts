import { collectUnreferencedBlobs } from "../src/server/blob-collection";

const COLLECTION_INTERVAL_MS = 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 60 * 1000;

async function collect(): Promise<void> {
  const { images, modelWeights } = await collectUnreferencedBlobs();
  console.log(
    `Collected ${images.length} image(s) and ${modelWeights.length} model weight object(s)`,
  );
}

/** Runs control-plane storage maintenance without coupling it to HTTP traffic. */
for (;;) {
  let delay = COLLECTION_INTERVAL_MS;
  try {
    await collect();
  } catch (error) {
    delay = RETRY_INTERVAL_MS;
    console.error("Blob collection failed", error);
  }
  await Bun.sleep(delay);
}

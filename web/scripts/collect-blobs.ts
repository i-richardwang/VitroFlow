import { collectUnreferencedBlobs } from "../src/server/blob-collection";

const collected = await collectUnreferencedBlobs();
console.log(
  `Collected ${collected.images.length} image(s) and ${collected.modelWeights.length} model weight object(s)`,
);

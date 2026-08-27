import { collectUnreferencedImages } from "../src/server/image-collection";

const collected = await collectUnreferencedImages();
console.log(`Collected ${collected.length} unreferenced image(s)`);
process.exit(0);

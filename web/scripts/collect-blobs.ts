import { bootstrap } from "../src/server/bootstrap";
import { closeDatabase } from "../src/server/infra/db/client";
import { collectUnreferencedBlobs } from "../src/server/maintenance/collection";

bootstrap();

try {
  const collected = await collectUnreferencedBlobs();
  console.log(
    `Collected ${collected.images.length} image(s) and ${collected.modelWeights.length} model weight object(s)`,
  );
} finally {
  await closeDatabase();
}

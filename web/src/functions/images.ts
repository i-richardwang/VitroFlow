import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { imageRefSchema } from "../domain/images/schema";
import { unclearImageRequestSchema } from "../domain/images/unclear";
import { clearImageUnclear, markImageUnclear } from "../server/images/public";
import { readSession } from "../server/transport/http/session";

async function actor() {
  const user = await readSession(getRequestHeaders());
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user.id;
}

/**
 * Marks a photograph unclear, or changes its mark, in the name of the
 * signed-in account. Saved on its own, apart from the image's review.
 */
export const markUnclear = createServerFn({ method: "POST" })
  .validator(unclearImageRequestSchema)
  .handler(async ({ data }) => markImageUnclear(data, await actor()));

/** Clears a photograph's mark, so that it reads as clear again. */
export const clearUnclear = createServerFn({ method: "POST" })
  .validator(imageRefSchema)
  .handler(async ({ data }) => {
    await actor();
    return clearImageUnclear(data);
  });

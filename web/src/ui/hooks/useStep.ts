import { type NavigateOptions, useRouter } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { loadPicture, previewSrc } from "../viewport/picture";

/**
 * Steps from one framed subject to the next. The page on view stays until
 * the next one's data and the preview of its picture are on hand, and is then
 * replaced whole, so a step never passes through an empty frame. `warm`
 * fetches a subject the reader is likely to step to, ahead of the step.
 * `pictureOf` names the picture in a page's loader data.
 */
export function useStep(pictureOf: (loaderData: unknown) => string | null) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const warm = useCallback(
    async (target: NavigateOptions) => {
      const matches = await router.preloadRoute(target);
      const digest = pictureOf(matches?.at(-1)?.loaderData);
      if (digest) await loadPicture(previewSrc(digest)).ready;
    },
    [router, pictureOf],
  );

  const step = useCallback(
    async (target: NavigateOptions) => {
      setPending(true);
      try {
        await warm(target);
      } finally {
        // Lowered before the next page renders, so it does not arrive pending.
        setPending(false);
      }
      await router.navigate(target);
    },
    [router, warm],
  );

  return { pending, step, warm };
}

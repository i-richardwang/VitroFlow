import { type NavigateOptions, useRouter } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { loadPicture, previewSrc } from "../viewport/picture";

/**
 * Steps from one framed subject to the next. The page on view stays until
 * the next one's data and the previews of its pictures are on hand, and is
 * then replaced whole, so a step never passes through an empty frame. `warm`
 * fetches a subject the reader is likely to step to, ahead of the step.
 * `picturesOf` names the pictures a page frames from its loader data.
 */
export function useStep(
  picturesOf: (loaderData: unknown) => readonly string[],
) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const warm = useCallback(
    async (target: NavigateOptions) => {
      const matches = await router.preloadRoute(target);
      const digests = picturesOf(matches?.at(-1)?.loaderData);
      await Promise.all(
        digests.map((digest) => loadPicture(previewSrc(digest)).ready),
      );
    },
    [router, picturesOf],
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

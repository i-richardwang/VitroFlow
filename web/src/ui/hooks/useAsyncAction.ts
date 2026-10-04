import { useCallback, useState } from "react";

import { errorMessage } from "../errors";
import { toast } from "../kit/Toast";

type ActionResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Runs `work` and reports a failure as an error toast titled `failure`; the
 * result says whether the work succeeded. Once `signal` aborts, the caller no
 * longer waits on the work, and a failure passes without a toast.
 */
export async function runAction<T>(
  work: () => Promise<T>,
  failure: string,
  signal?: AbortSignal,
): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (!signal?.aborted) {
      toast.error({ title: failure, description: errorMessage(error) });
    }
    return { ok: false, error };
  }
}

/** One action's busy flag and a `runAction` that raises it while the work runs. */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T>(work: () => Promise<T>, failure: string) => {
      setBusy(true);
      try {
        return await runAction(work, failure);
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  return { busy, run };
}

export type AsyncAction = ReturnType<typeof useAsyncAction>;

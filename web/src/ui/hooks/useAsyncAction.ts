import { useCallback, useState } from "react";

import { errorMessage } from "../errors";
import { toast } from "../kit/Toast";

export type ActionResult<T> =
  { ok: true; value: T } | { ok: false; error: unknown };

export async function performAction<T>(
  work: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * One action's busy flag and runner. A failure is reported as an error toast
 * titled `failure`; the result says whether the work succeeded.
 */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T>(work: () => Promise<T>, failure: string) => {
      setBusy(true);
      try {
        const result = await performAction(work);
        if (!result.ok) {
          toast.error({
            title: failure,
            description: errorMessage(result.error),
          });
        }
        return result;
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  return { busy, run };
}

export type AsyncAction = ReturnType<typeof useAsyncAction>;

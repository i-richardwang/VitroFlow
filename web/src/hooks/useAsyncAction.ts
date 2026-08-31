import { toast } from "@heroui/react";
import { useCallback, useState } from "react";

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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T>(work: () => Promise<T>, failure: string) => {
      setBusy(true);
      try {
        const result = await performAction(work);
        if (!result.ok) {
          toast.danger(failure, { description: errorMessage(result.error) });
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

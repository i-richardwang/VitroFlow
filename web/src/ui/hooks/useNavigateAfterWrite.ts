import { type NavigateOptions, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

/**
 * Moves the reader to another page after a write. The pages entered load
 * afresh; what stays on screen, such as the navigation's experiments, and
 * every page held in the cache or loaded ahead is read again, so nothing the
 * reader sees next predates the write.
 */
export function useNavigateAfterWrite() {
  const router = useRouter();
  return useCallback(
    async (target: NavigateOptions) => {
      await router.navigate(target);
      await router.invalidate({ filter: (match) => match.cause !== "enter" });
    },
    [router],
  );
}

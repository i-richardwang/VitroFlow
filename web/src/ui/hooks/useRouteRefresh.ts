import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * Reloads the current route's data every `intervalMs` while the tab is visible
 * and `enabled` holds. A tick that falls while the router is loading, a
 * reload still under way or the way to another page, is skipped: reloading
 * then would begin that load again.
 */
export function useRouteRefresh(intervalMs: number, enabled = true): void {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState !== "visible" || router.state.isLoading) {
        return;
      }
      void router.invalidate();
    };
    const timer = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, router]);
}

const RETURN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Reloads the current route's data when the reader comes back to a tab left
 * for five minutes or more, so what they return to is not what they left.
 */
export function useRefreshOnReturn(): void {
  const router = useRouter();
  useEffect(() => {
    let leftAt: number | null = null;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        leftAt = Date.now();
        return;
      }
      if (leftAt !== null && Date.now() - leftAt >= RETURN_INTERVAL_MS) {
        void router.invalidate();
      }
      leftAt = null;
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [router]);
}

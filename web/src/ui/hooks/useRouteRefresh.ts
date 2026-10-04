import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

/** Reloads the current route's data every `intervalMs` while the tab is visible and `enabled` holds. */
export function useRouteRefresh(intervalMs: number, enabled = true): void {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void router.invalidate();
    };
    const timer = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, router]);
}

import { useEffect } from "react";

export function useRouteRefresh(
  router: { invalidate: () => Promise<unknown> },
  intervalMs: number,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void router.invalidate();
    };
    const timer = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, router]);
}

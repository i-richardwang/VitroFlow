import type { ReactNode } from "react";

/** The level-two heading shared by page-level empty states. */
export function EmptyStateHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="empty-state__title" data-slot="empty-state-title">
      {children}
    </h2>
  );
}

import type { ReactNode } from "react";

/* The product's mark in white on a tile of the brand's greens, 40px or 28px. */
export function LogoTile({
  children,
  size = "large",
}: {
  children: ReactNode;
  size?: "small" | "large";
}) {
  return (
    <span aria-hidden className="ui-logo-tile" data-size={size}>
      {children}
    </span>
  );
}

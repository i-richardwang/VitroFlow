import type { ComponentPropsWithoutRef } from "react";

type BrandLogoProps = Omit<ComponentPropsWithoutRef<"img">, "alt" | "src">;

/** The decorative application mark; its visible name is rendered beside it. */
export function BrandLogo(props: BrandLogoProps) {
  return <img src="/logo.svg" alt="" {...props} />;
}

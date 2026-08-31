import type { ComponentPropsWithoutRef } from "react";

type BrandLogoProps = Omit<ComponentPropsWithoutRef<"img">, "alt" | "src">;

export function BrandLogo(props: BrandLogoProps) {
  return <img src="/logo.svg" alt="" {...props} />;
}

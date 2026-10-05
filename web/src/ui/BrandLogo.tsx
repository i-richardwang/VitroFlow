import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./kit/cn";
import { LogoTile } from "./kit/LogoTile";

/** The mark, drawn in the current text color so it reads on either scheme. */
export function BrandLogo({
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<"span">, "children" | "style">) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block shrink-0 bg-current mask-[url(/logo.svg)] mask-center mask-contain mask-no-repeat",
        className,
      )}
      {...props}
    />
  );
}

/** The mark on its tile, for the top row of pages outside the signed-in shell. */
export function AppBrand() {
  return (
    <span className="flex items-center">
      <LogoTile>
        <BrandLogo />
      </LogoTile>
    </span>
  );
}

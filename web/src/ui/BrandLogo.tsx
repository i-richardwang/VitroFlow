import type { ComponentPropsWithoutRef } from "react";

import { m } from "../paraglide/messages";
import { cn } from "./kit/cn";
import { Text } from "./kit/Text";

/** The mark, drawn in the current text color so it reads on either scheme. */
export function BrandLogo({
  className,
  style,
  ...props
}: Omit<ComponentPropsWithoutRef<"span">, "children">) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{
        mask: "url(/logo.svg) center / contain no-repeat",
        ...style,
      }}
      {...props}
    />
  );
}

/** Mark and product name, for pages outside the signed-in shell. */
export function AppBrand() {
  return (
    <span className="flex items-center gap-2.5">
      <BrandLogo className="size-6" />
      <Text as="span" className="font-bold">
        {m.app_name()}
      </Text>
    </span>
  );
}

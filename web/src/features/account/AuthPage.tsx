import type { ComponentProps } from "react";

import { m } from "../../paraglide/messages";
import { AppBrand } from "../../ui/BrandLogo";
import { LanguageSelect } from "../../ui/LanguageSelect";
import { AuthLayout } from "../../ui/kit/AuthLayout";

/** A page outside the signed-in shell: the brand above, the language below. */
export function AuthPage(
  props: Omit<ComponentProps<typeof AuthLayout>, "brand" | "footer">,
) {
  return (
    <AuthLayout
      {...props}
      brand={<AppBrand />}
      footer={
        <div className="w-32">
          <LanguageSelect aria-label={m.account_language()} quiet />
        </div>
      }
    />
  );
}

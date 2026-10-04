import { m } from "../paraglide/messages";
import {
  getLocale,
  locales,
  setLocale,
  type Locale,
} from "../paraglide/runtime";
import { Select } from "./kit/Select";

const LOCALE_NAMES: Record<Locale, () => string> = {
  en: m.account_language_en,
  "zh-CN": m.account_language_zh_cn,
};

/**
 * The reader's language. Choosing one stores the locale cookie and reloads,
 * so the server renders the next document in that language. `quiet` draws it
 * small and borderless, for a page's footer.
 */
export function LanguageSelect({
  "aria-label": ariaLabel,
  quiet = false,
}: {
  "aria-label": string;
  quiet?: boolean;
}) {
  return (
    <Select<Locale>
      aria-label={ariaLabel}
      size={quiet ? "small" : undefined}
      variant={quiet ? "borderless" : undefined}
      value={getLocale()}
      options={locales.map((locale) => ({
        value: locale,
        label: LOCALE_NAMES[locale](),
      }))}
      onChange={(locale) => {
        if (locale !== getLocale()) void setLocale(locale);
      }}
    />
  );
}

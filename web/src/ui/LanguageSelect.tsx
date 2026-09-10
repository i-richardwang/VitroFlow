import { Label, ListBox, Select } from "@heroui/react";

import { m } from "../paraglide/messages";
import {
  getLocale,
  locales,
  setLocale,
  type Locale,
} from "../paraglide/runtime";

const LOCALE_NAMES: Record<Locale, () => string> = {
  en: m.account_language_en,
  "zh-CN": m.account_language_zh_cn,
};

/**
 * The reader's language. Choosing one stores the locale cookie and reloads,
 * so the server renders the next document in that language.
 */
export function LanguageSelect() {
  return (
    <Select
      variant="secondary"
      fullWidth
      selectedKey={getLocale()}
      onSelectionChange={(key) => {
        if (key != null && key !== getLocale()) {
          void setLocale(key as Locale);
        }
      }}
    >
      <Label>{m.account_language()}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {locales.map((locale) => (
            <ListBox.Item
              key={locale}
              id={locale}
              textValue={LOCALE_NAMES[locale]()}
            >
              {LOCALE_NAMES[locale]()}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

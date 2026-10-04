import { getLocale } from "../paraglide/runtime";

/** Things of one kind in a sentence, joined the way the reader's language joins them ("a, b, and c"). */
export function formatList(items: readonly string[]): string {
  return new Intl.ListFormat(getLocale(), { type: "conjunction" }).format(
    items,
  );
}

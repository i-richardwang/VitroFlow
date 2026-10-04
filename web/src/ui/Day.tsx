import { getLocale } from "../paraglide/runtime";

/** A calendar day (`YYYY-MM-DD`) in the locale's notation, read in UTC so no time zone moves it. */
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

export function Day({ value }: { value: string }) {
  return <time dateTime={value}>{formatDay(value)}</time>;
}

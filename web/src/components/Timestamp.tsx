export function formatTimestampUtc(value: string): string {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function Timestamp({ value }: { value: string }) {
  return <time dateTime={value}>{formatTimestampUtc(value)}</time>;
}

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

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
  const text = useSyncExternalStore(
    subscribe,
    () => new Date(value).toLocaleString(),
    () => formatTimestampUtc(value),
  );
  return (
    <time dateTime={value} title={formatTimestampUtc(value)}>
      {text}
    </time>
  );
}

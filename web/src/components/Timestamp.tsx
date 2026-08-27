/**
 * A moment rendered in the viewer's locale. The server and browser format it
 * differently, so hydration keeps the browser's text.
 */
export function Timestamp({ value }: { value: string }) {
  return (
    <time dateTime={value} suppressHydrationWarning>
      {new Date(value).toLocaleString()}
    </time>
  );
}

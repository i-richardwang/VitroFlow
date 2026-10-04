import { CopyButton } from "./CopyButton";

/*
 * A read-only value to copy, such as an address, a key or a command: the
 * text in small monospaced type on a faint fill, on one line that scrolls
 * sideways when it must, and a copy button at the end of the row.
 */
export function Snippet({ children }: { children: string }) {
  return (
    <div className="ui-snippet">
      <code className="ui-snippet-code">{children}</code>
      <CopyButton content={children} />
    </div>
  );
}

import { m } from "../paraglide/messages";

/** Stands in a table cell or fact for a value that does not exist yet. */
export function Absent() {
  return (
    <span className="text-fg-quaternary">
      <span aria-hidden>—</span>
      <span className="sr-only">{m.ui_no_data()}</span>
    </span>
  );
}

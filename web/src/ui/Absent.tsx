import { m } from "../paraglide/messages";
import { Text } from "./kit/Text";

/** Stands in a table cell or fact for a value that does not exist yet. */
export function Absent() {
  return (
    <Text as="span" type="quaternary">
      <span aria-hidden>—</span>
      <span className="sr-only">{m.ui_no_data()}</span>
    </Text>
  );
}

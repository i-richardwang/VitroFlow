import { Ellipsis } from "lucide-react";

import { ActionIcon } from "./kit/ActionIcon";
import { Button } from "./kit/Button";
import { DropdownMenu, type DropdownItem } from "./kit/DropdownMenu";

type ActionsMenuProps = {
  /** Names the trigger, e.g. "Actions for A1". */
  label: string;
  items: DropdownItem[];
  disabled?: boolean;
};

/** The "…" menu at the end of a table row or list item. */
export function RowMenu({ label, items, disabled }: ActionsMenuProps) {
  return (
    <DropdownMenu items={items} placement="bottomRight">
      <ActionIcon
        icon={Ellipsis}
        size="small"
        disabled={disabled}
        aria-label={label}
      />
    </DropdownMenu>
  );
}

/** The "…" menu beside a page's or workbench's primary actions. */
export function PageMenu({ label, items, disabled }: ActionsMenuProps) {
  return (
    <DropdownMenu items={items} placement="bottomRight">
      <Button icon={Ellipsis} disabled={disabled} aria-label={label} />
    </DropdownMenu>
  );
}

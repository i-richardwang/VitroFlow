import { Menu } from "@base-ui/react/menu";
import type { LucideIcon } from "lucide-react";
import type { Key, ReactElement } from "react";
import { cn } from "./cn";
import {
  defaultPortalContainer,
  type Placement,
  placementMap,
  triggerRender,
} from "./floating";
import { Icon } from "./Icon";
import { resolveNativeButton } from "./nativeButton";

/*
 * A menu opened by clicking its trigger. `items` describes the menu (plain
 * items and dividers); Base UI owns the open state and mounts the items only
 * while the menu is open or closing. When any item has an icon, every item reserves the icon slot so
 * labels line up. The trigger gets no class: its open fill is selected by
 * `[aria-haspopup="menu"][data-popup-open]` in the base layer of `app.css`,
 * and the base focus ring skips elements with `ui-` classes.
 */

interface MenuItemType {
  danger?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  key: Key;
  label: string;
  onClick?: () => void;
  type?: "item";
}

interface MenuDividerType {
  type: "divider";
}

export type DropdownItem = MenuItemType | MenuDividerType;

function renderItems(items: DropdownItem[]) {
  const reserveIconSpace = items.some(
    (item) => item.type !== "divider" && item.icon,
  );
  return items.map((item, index) =>
    item.type === "divider" ? (
      <Menu.Separator className="ui-dropdown-menu-separator" key={index} />
    ) : (
      <Menu.Item
        className={cn(
          "ui-dropdown-menu-item",
          item.danger && "ui-dropdown-menu-danger",
        )}
        disabled={item.disabled}
        key={item.key}
        label={item.label}
        onClick={item.onClick}
      >
        <div className="ui-dropdown-menu-item-content">
          {reserveIconSpace ? (
            <span aria-hidden={!item.icon} className="ui-dropdown-menu-icon">
              {item.icon ? <Icon icon={item.icon} /> : null}
            </span>
          ) : null}
          <span className="ui-dropdown-menu-label">{item.label}</span>
        </div>
      </Menu.Item>
    ),
  );
}

interface DropdownMenuProps {
  /** The trigger: a single element such as a Button or ActionIcon. */
  children: ReactElement;
  items: DropdownItem[];
  placement?: Extract<Placement, "bottomLeft" | "bottomRight">;
}

export function DropdownMenu({
  children,
  items,
  placement = "bottomLeft",
}: DropdownMenuProps) {
  const { align, side } = placementMap[placement];

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        nativeButton={resolveNativeButton(children)}
        render={triggerRender(children)}
      />
      <Menu.Portal container={defaultPortalContainer()}>
        <Menu.Positioner
          align={align}
          className="ui-dropdown-menu-positioner"
          data-placement={placement}
          side={side}
          sideOffset={6}
        >
          <Menu.Popup className="ui-dropdown-menu-popup">
            {renderItems(items)}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

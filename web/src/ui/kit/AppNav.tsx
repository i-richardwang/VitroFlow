import type { ReactNode } from "react";
import { m } from "../../paraglide/messages";
import { useAppShell } from "./AppShell";
import { Icon, type IconProps } from "./Icon";
import { ScrollShadow } from "./ScrollShadow";

export interface AppNavItem {
  href: string;
  icon: IconProps["icon"];
  label: string;
}

export interface AppNavLinkProps {
  "aria-current"?: "page";
  children: ReactNode;
  className: string;
  "data-active": boolean;
  href: string;
  /** Closes the compact navigation drawer. */
  onClick: () => void;
}

/** Whether `pathname` is the item's page or one below it. */
export function matchesNavPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Longest matching href wins, so a nested page lights up only its own item. */
function resolveActiveHref(pathname: string, items: readonly AppNavItem[]) {
  return items
    .filter((item) => matchesNavPath(pathname, item.href))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;
}

/**
 * The sidebar's list of places: each a 36px row with its icon in a 28px slot.
 * The current place is filled; the others stay secondary until hovered.
 */
export function AppNav({
  items,
  pathname,
  renderLink,
}: {
  items: AppNavItem[];
  pathname: string;
  /**
   * Renders each item link, for example as a router link that receives
   * `href`, `className`, the `data-*` and `aria-*` props and `onClick`.
   */
  renderLink: (props: AppNavLinkProps) => ReactNode;
}) {
  const shell = useAppShell();
  const activeHref = resolveActiveHref(pathname, items);
  return (
    <ScrollShadow
      aria-label={m.ui_nav_label()}
      as="nav"
      className="ui-app-nav"
      size={4}
    >
      {items.map((item) => {
        const active = item.href === activeHref;
        return renderLink({
          "aria-current": active ? "page" : undefined,
          children: (
            <>
              <span className="ui-app-nav-item-icon">
                <Icon icon={item.icon} size={18} />
              </span>
              <span className="ui-app-nav-item-label">{item.label}</span>
            </>
          ),
          className: "ui-app-nav-item",
          "data-active": active,
          href: item.href,
          onClick: shell.closeNavigation,
        });
      })}
    </ScrollShadow>
  );
}

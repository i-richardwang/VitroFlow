import { ChevronDown } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { m } from "../../paraglide/messages";
import { useAppShell } from "./AppShell";
import { Icon, type IconProps } from "./Icon";
import { durationMs } from "./motionToken";
import { ScrollShadow } from "./ScrollShadow";
import { Tooltip } from "./Tooltip";

export interface AppNavItem {
  href: string;
  icon: IconProps["icon"];
  label: string;
}

export interface AppNavGroup {
  items: AppNavItem[];
  key: string;
  label: string;
}

export interface AppNavLinkProps {
  "aria-current"?: "page";
  "aria-label"?: string;
  children: ReactNode;
  className: string;
  "data-active": boolean;
  "data-collapsed": boolean;
  href: string;
  /** Closes the compact navigation drawer. */
  onClick: () => void;
  title?: string;
}

/** Whether `pathname` is the item's page or one below it. */
export function matchesNavPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Longest matching href wins, so a nested page lights up only its own item. */
function resolveActiveHref(pathname: string, groups: readonly AppNavGroup[]) {
  return groups
    .flatMap((group) => group.items)
    .filter((item) => matchesNavPath(pathname, item.href))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;
}

function scrollActiveIntoView(container: HTMLElement) {
  const link = container.querySelector<HTMLElement>('[aria-current="page"]');
  if (!link) return;
  const containerRect = container.getBoundingClientRect();
  const linkRect = link.getBoundingClientRect();
  if (
    linkRect.top >= containerRect.top &&
    linkRect.bottom <= containerRect.bottom
  )
    return;
  container.scrollTop +=
    linkRect.top -
    containerRect.top -
    (containerRect.height - linkRect.height) / 2;
}

function NavLink({
  active,
  collapsed,
  item,
  name,
  renderLink,
}: {
  active: boolean;
  collapsed: boolean;
  item: AppNavItem;
  name: string;
  renderLink: (props: AppNavLinkProps) => ReactNode;
}) {
  const shell = useAppShell();
  const link = renderLink({
    "aria-current": active ? "page" : undefined,
    "aria-label": collapsed ? name : undefined,
    children: (
      <>
        <Icon icon={item.icon} size={18} />
        {collapsed ? null : (
          <span className="ui-app-nav-item-label">{item.label}</span>
        )}
      </>
    ),
    className: "ui-app-nav-item",
    "data-active": active,
    "data-collapsed": collapsed,
    href: item.href,
    onClick: shell.closeNavigation,
    title: collapsed ? undefined : item.label,
  });

  if (!collapsed) return link;
  return (
    <Tooltip placement="right" title={name}>
      {link as ReactElement}
    </Tooltip>
  );
}

/**
 * Grouped sidebar navigation. Highlights the longest matching path, folds
 * groups, and follows the shell's icon rail, where each group becomes a run
 * of icons.
 */
export function AppNav({
  groups,
  pathname,
  renderLink,
}: {
  groups: AppNavGroup[];
  pathname: string;
  /**
   * Renders each item link, for example as a router link that receives
   * `href`, `className`, the `data-*` and `aria-*` props and `onClick`.
   */
  renderLink: (props: AppNavLinkProps) => ReactNode;
}) {
  const id = useId();
  const navRef = useRef<HTMLDivElement>(null);
  const { collapsed } = useAppShell();
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const activeHref = resolveActiveHref(pathname, groups);
  const activeGroup = groups.find((group) =>
    group.items.some((item) => item.href === activeHref),
  )?.key;

  // Arriving on a page reopens its group even if it was closed by hand earlier.
  const [trackedPathname, setTrackedPathname] = useState(pathname);
  if (trackedPathname !== pathname) {
    setTrackedPathname(pathname);
    if (activeGroup && closed[activeGroup]) {
      setClosed({ ...closed, [activeGroup]: false });
    }
  }

  // Re-centers whenever the active page or the rail changes.
  useEffect(() => {
    const container = navRef.current;
    if (!container) return;
    scrollActiveIntoView(container);
    // Once more after an opening group panel has finished growing.
    const timer = window.setTimeout(
      () => scrollActiveIntoView(container),
      durationMs("--duration-base"),
    );
    return () => window.clearTimeout(timer);
  }, [activeHref, collapsed, pathname]);

  const links = (group: AppNavGroup, rail: boolean) =>
    group.items.map((item) => (
      <NavLink
        active={item.href === activeHref}
        collapsed={rail}
        item={item}
        key={item.href}
        name={`${group.label} / ${item.label}`}
        renderLink={renderLink}
      />
    ));

  if (collapsed) {
    return (
      <ScrollShadow
        aria-label={m.ui_nav_label()}
        as="nav"
        className="ui-app-nav"
        data-collapsed=""
        ref={navRef}
        size={8}
      >
        {groups.map((group, index) => (
          <div
            className="ui-app-nav-rail-group"
            data-first={index === 0}
            key={group.key}
          >
            <h2 className="sr-only">{group.label}</h2>
            {links(group, true)}
          </div>
        ))}
      </ScrollShadow>
    );
  }

  return (
    <ScrollShadow
      aria-label={m.ui_nav_label()}
      as="nav"
      className="ui-app-nav"
      ref={navRef}
      size={4}
    >
      {groups.map((group) => {
        const expanded = !closed[group.key];
        const panelId = `${id}-${group.key}`;
        return (
          <div className="ui-app-nav-group" key={group.key}>
            <button
              aria-controls={panelId}
              aria-expanded={expanded}
              className="ui-app-nav-group-header"
              data-active={group.key === activeGroup}
              type="button"
              onClick={() => setClosed({ ...closed, [group.key]: expanded })}
            >
              <span className="ui-app-nav-item-label">{group.label}</span>
              <Icon
                className="ui-app-nav-chevron"
                data-expanded={expanded}
                icon={ChevronDown}
                size={14}
              />
            </button>
            <div
              aria-hidden={!expanded}
              className="ui-app-nav-group-panel"
              data-expanded={expanded}
              id={panelId}
              inert={!expanded}
            >
              <div className="ui-app-nav-group-items">
                {links(group, false)}
              </div>
            </div>
          </div>
        );
      })}
    </ScrollShadow>
  );
}

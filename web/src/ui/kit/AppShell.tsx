import { PanelLeft } from "lucide-react";
import {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  use,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { m } from "../../paraglide/messages";
import { Button } from "./Button";
import { cn } from "./cn";
import { Drawer } from "./Drawer";
import { Flexbox } from "./Flex";
import { useIsCompact } from "./mediaQuery";

export interface AppShellState {
  /** Closes the compact navigation drawer. */
  closeNavigation: () => void;
  /** Icon rail, only when the sidebar is collapsed on a wide viewport. */
  collapsed: boolean;
}

const AppShellContext = createContext<AppShellState | null>(null);

export function useAppShell(): AppShellState {
  const value = use(AppShellContext);
  if (!value) throw new Error("useAppShell must be used within AppShell");
  return value;
}

export interface AppShellBrandLinkProps {
  "aria-label": string;
  children: ReactNode;
  className: string;
  href: string;
  /** Closes the compact navigation drawer. */
  onClick: () => void;
}

/** Home link at the top of the sidebar; only the mark shows on the rail. */
export function AppShellBrand({
  href,
  logo,
  renderLink,
  title,
}: {
  href: string;
  /** Mark shown on its own when the sidebar is an icon rail. */
  logo: ReactNode;
  /** Renders the home link, for example as a router link. */
  renderLink: (props: AppShellBrandLinkProps) => ReactNode;
  /** Name beside the mark; also names the link. */
  title: string;
}) {
  const shell = useAppShell();
  return renderLink({
    "aria-label": title,
    children: shell.collapsed ? (
      logo
    ) : (
      <span className="ui-app-shell-brand-lockup">
        {logo}
        <span className="ui-app-shell-brand-name">{title}</span>
      </span>
    ),
    className: "ui-app-shell-brand-anchor",
    href,
    onClick: shell.closeNavigation,
  });
}

export interface AppShellProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> {
  /** Home mark, usually an `AppShellBrand`. Rendered at the top of the sidebar. */
  brand: ReactNode;
  /** Location shown in the top bar, usually a `Breadcrumb`. */
  breadcrumb: ReactNode;
  children?: ReactNode;
  /** Collapse the sidebar to an icon rail. Ignored while compact. */
  collapsed: boolean;
  /** Account menu or other content pinned to the bottom of the sidebar. */
  footer: ReactNode;
  /** Navigation, usually an `AppNav`; the rail state comes from the shell. */
  navigation: ReactNode;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Actions at the end of the top bar. */
  tools: ReactNode;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * The workspace card's content edge to edge: it cancels the card's padding
 * and fills its height, for a page that lays out its own panes and scrolling.
 */
export function AppShellFlush({ children }: { children: ReactNode }) {
  return <div className="ui-app-shell-flush">{children}</div>;
}

/**
 * App frame: a sidebar that collapses to an icon rail and becomes a drawer
 * below the laptop breakpoint, a top bar, and an inset workspace card.
 * Mod+B toggles the sidebar while focus is inside the shell.
 */
export function AppShell({
  brand,
  breadcrumb,
  children,
  className,
  collapsed,
  footer,
  navigation,
  onCollapsedChange,
  tools,
  ...rest
}: AppShellProps) {
  const mainId = `app-main-${useId().replaceAll(":", "")}`;
  const shellRef = useRef<HTMLDivElement>(null);
  const isCompact = useIsCompact();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The workspace shows a focus ring only when the skip link moved focus there.
  const [skippedToMain, setSkippedToMain] = useState(false);
  const railed = collapsed && !isCompact;

  const closeNavigation = () => setDrawerOpen(false);
  const toggleNavigation = () => {
    if (isCompact) {
      setDrawerOpen((open) => !open);
      return;
    }
    onCollapsedChange(!collapsed);
  };
  const toggleRef = useRef(toggleNavigation);
  useEffect(() => {
    toggleRef.current = toggleNavigation;
  });

  useEffect(() => {
    const node = shellRef.current;
    if (!node) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "b" ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey
      ) {
        return;
      }
      if (event.repeat || isTypingTarget(event.target)) return;
      if (!node.contains(event.target as Node)) return;
      event.preventDefault();
      toggleRef.current();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const sidebar = (rail: boolean) => (
    <AppShellContext value={{ closeNavigation, collapsed: rail }}>
      <div className="ui-app-shell-brand" data-collapsed={rail}>
        {brand}
      </div>
      <div className="ui-app-shell-nav-slot">{navigation}</div>
      <div className="ui-app-shell-sidebar-bottom">{footer}</div>
    </AppShellContext>
  );

  const toggleLabel = isCompact
    ? m.ui_shell_open_navigation()
    : railed
      ? m.ui_shell_expand()
      : m.ui_shell_collapse();

  return (
    <div className={cn("ui-app-shell", className)} ref={shellRef} {...rest}>
      <a
        className="ui-app-shell-skip-link"
        href={`#${mainId}`}
        onClick={(event) => {
          event.preventDefault();
          setSkippedToMain(true);
          document.getElementById(mainId)?.focus();
        }}
      >
        {m.ui_shell_skip_to_content()}
      </a>
      <aside className="ui-app-shell-sidebar" data-collapsed={railed}>
        {!isCompact && sidebar(railed)}
      </aside>
      {isCompact ? (
        <Drawer
          aria-label={m.ui_nav_label()}
          noHeader
          open={drawerOpen}
          placement="left"
          width={272}
          onClose={closeNavigation}
        >
          <Flexbox height="100%">{sidebar(false)}</Flexbox>
        </Drawer>
      ) : null}
      <div className="ui-app-shell-workspace">
        <header className="ui-app-shell-topbar">
          <Button
            aria-label={toggleLabel}
            icon={PanelLeft}
            type="text"
            onClick={toggleNavigation}
          />
          <span aria-hidden className="ui-app-shell-topbar-divider" />
          <div className="ui-app-shell-topbar-main">{breadcrumb}</div>
          <div className="ui-app-shell-tools">{tools}</div>
        </header>
        <main
          className="ui-app-shell-main"
          data-skip-target={skippedToMain || undefined}
          id={mainId}
          tabIndex={-1}
          onBlur={(event) => {
            if (event.target === event.currentTarget) setSkippedToMain(false);
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

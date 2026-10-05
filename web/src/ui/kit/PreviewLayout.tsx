import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { m } from "../../paraglide/messages";
import { ActionIcon } from "./ActionIcon";
import { AppShellFlush, AppShellPane } from "./AppShell";
import { Drawer } from "./Drawer";
import { useIsCompact } from "./mediaQuery";

const PANEL_WIDTH = 360;

export interface Preview {
  title: ReactNode;
  content: ReactNode;
  onClose: () => void;
}

/*
 * A document page that shows one of its rows beside it. The page fills the
 * shell's card and scrolls in its own column, padded as the card pads a
 * page; while `preview` is set a 360px panel stands at the card's end, ruled
 * off by a hairline, with its title and a close button over its scrolling
 * content. Below the laptop breakpoint the panel is a drawer instead.
 */
export function PreviewLayout({
  children,
  preview,
}: {
  children: ReactNode;
  preview: Preview | null;
}) {
  const compact = useIsCompact();
  // The drawer keeps showing what it held while it closes.
  const shown = useRef(preview);
  if (preview) shown.current = preview;
  const held = preview ?? shown.current;

  return (
    <AppShellFlush>
      <AppShellPane>{children}</AppShellPane>
      {compact ? (
        <Drawer
          open={preview !== null}
          title={held?.title}
          width={PANEL_WIDTH}
          onClose={() => preview?.onClose()}
        >
          <div className="ui-preview-stack">{held?.content}</div>
        </Drawer>
      ) : preview ? (
        <aside className="ui-preview-panel">
          <header className="ui-preview-panel-header">
            <h2 className="ui-preview-panel-title">{preview.title}</h2>
            <ActionIcon
              icon={X}
              size="small"
              title={m.ui_close()}
              onClick={preview.onClose}
            />
          </header>
          <div className="ui-preview-panel-body">
            <div className="ui-preview-stack">{preview.content}</div>
          </div>
        </aside>
      ) : null}
    </AppShellFlush>
  );
}

/** One fact in a preview: a small label over its value on a band of fill. */
export function PreviewField({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ui-preview-field">
      <div className="ui-preview-field-label">{label}</div>
      <div className="ui-preview-field-value">{children}</div>
    </div>
  );
}

/** A picture at the top of a preview, whole and centered on a band of fill. */
export function PreviewMedia({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="ui-preview-media">
      <img alt={alt} decoding="async" key={src} loading="lazy" src={src} />
    </div>
  );
}

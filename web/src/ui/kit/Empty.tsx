import type { ReactNode } from "react";
import { m } from "../../paraglide/messages";
import { Block } from "./Block";
import { cn } from "./cn";
import { Flexbox } from "./Flex";
import { Icon, type IconProps } from "./Icon";

/*
 * An empty state: a centered column of a mark, a title, a description and the
 * way forward 16px below them. `middle` (the default) sits in the place of a
 * table, a list or a panel's content; `large` fills a whole pane. Without
 * `icon`, the default image is drawn.
 */

export interface EmptyProps {
  action?: ReactNode;
  description?: ReactNode;
  icon?: IconProps["icon"];
  size?: "middle" | "large";
  title?: ReactNode;
}

/** The default image: an empty card with three placeholder bars, standing on a shadow. */
function EmptyImage() {
  return (
    <svg
      className="ui-empty-image"
      height="41"
      viewBox="0 0 64 41"
      width="64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{m.ui_no_data()}</title>
      <ellipse
        className="ui-empty-image-shadow"
        cx="32"
        cy="35"
        rx="26"
        ry="5"
      />
      <rect
        className="ui-empty-image-card"
        height="30"
        rx="4"
        width="36"
        x="14"
        y="2.5"
      />
      <rect
        className="ui-empty-image-line"
        height="3"
        rx="1.5"
        width="22"
        x="21"
        y="10"
      />
      <rect
        className="ui-empty-image-line"
        height="3"
        rx="1.5"
        width="22"
        x="21"
        y="16"
      />
      <rect
        className="ui-empty-image-line"
        height="3"
        rx="1.5"
        width="13"
        x="21"
        y="22"
      />
    </svg>
  );
}

export function Empty({
  title,
  description,
  icon,
  action,
  size = "middle",
}: EmptyProps) {
  const large = size === "large";
  return (
    <div className={cn("ui-empty", large && "ui-empty-large")}>
      {icon && large ? (
        <Icon className="ui-empty-icon-bare" icon={icon} size={48} />
      ) : icon ? (
        <Block
          align="center"
          className="ui-empty-icon-box"
          justify="center"
          variant="outlined"
        >
          <Icon className="ui-empty-icon" icon={icon} size={24} />
        </Block>
      ) : (
        <EmptyImage />
      )}
      <div className="ui-empty-text">
        {title && <div className="ui-empty-title">{title}</div>}
        {description && (
          <div className="ui-empty-description">{description}</div>
        )}
      </div>
      {action && (
        <Flexbox className="ui-empty-action" horizontal gap={8} align="center">
          {action}
        </Flexbox>
      )}
    </div>
  );
}

import type { ReactNode } from "react";
import { m } from "../../paraglide/messages";
import { Block } from "./Block";
import { cn } from "./cn";
import { Flexbox } from "./Flex";
import { Icon, type IconProps } from "./Icon";

/*
 * An empty state: a centered column. `middle` (the default) sits inside a
 * surface such as a table, drawer or popup; `large` fills a whole column or
 * page. Without `icon`, the default image is drawn.
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
    <Flexbox
      align="center"
      gap={large ? 16 : 8}
      padding={large ? undefined : 16}
      paddingBlock={large ? 64 : undefined}
    >
      {icon && large ? (
        <Icon className="ui-empty-icon-bare" icon={icon} size={48} />
      ) : icon ? (
        <Block
          align="center"
          className="ui-empty-icon-box"
          justify="center"
          variant="outlined"
        >
          <Icon className="ui-empty-icon" icon={icon} size={32} />
        </Block>
      ) : (
        <EmptyImage />
      )}
      <Flexbox align="center" gap={large ? 4 : 1}>
        {title && <div className="ui-empty-title">{title}</div>}
        {description && (
          <div
            className={cn(
              "ui-empty-description",
              large && "ui-empty-description-large",
            )}
          >
            {description}
          </div>
        )}
      </Flexbox>
      {action && <Flexbox gap={4}>{action}</Flexbox>}
    </Flexbox>
  );
}

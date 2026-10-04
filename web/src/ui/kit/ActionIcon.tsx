import { Button, type ButtonProps } from "./Button";
import { cn } from "./cn";
import { Icon, type IconProps } from "./Icon";
import { Tooltip, type TooltipProps } from "./Tooltip";

/*
 * A borderless square Button with a tertiary glyph color. Sizes: small 24
 * with glyph 14, control 32 with glyph 16 (the height of a middle Input, for
 * a row of form controls), middle 36 with glyph 20. A `title` wraps it in a
 * tooltip that ignores the pointer. A `tabIndex` passed in wins, so a
 * Toolbar's roving focus is kept.
 */

export type ActionIconSize = "small" | "control" | "middle";

export interface ActionIconProps extends Omit<
  ButtonProps,
  "children" | "icon" | "size" | "type" | "title" | "danger"
> {
  active?: boolean;
  icon: IconProps["icon"];
  size?: ActionIconSize;
  title?: TooltipProps["title"];
  tooltipProps?: Omit<TooltipProps, "children" | "title">;
}

const SIZE = {
  small: { button: "small", className: "ui-action-icon-small", glyph: 14 },
  control: { button: "middle", className: undefined, glyph: 16 },
  middle: { button: "middle", className: "ui-action-icon-middle", glyph: 20 },
} as const;

export function ActionIcon({
  active,
  className,
  disabled,
  icon,
  size = "middle",
  title,
  tooltipProps,
  ...props
}: ActionIconProps) {
  const preset = SIZE[size];
  // The tooltip does not name its trigger, so a string title names the button when no aria-label is given.
  const ariaLabel =
    props["aria-label"] ?? (typeof title === "string" ? title : undefined);
  const button = (
    <Button
      {...props}
      aria-label={ariaLabel}
      className={cn(
        "ui-action-icon",
        preset.className,
        active && "ui-action-icon-active",
        className,
      )}
      disabled={disabled}
      htmlType="button"
      icon={
        <Icon
          icon={icon}
          size={preset.glyph}
          style={{ pointerEvents: "none" }}
        />
      }
      size={preset.button}
      tabIndex={props.tabIndex ?? (disabled ? -1 : 0)}
      type="text"
    />
  );
  if (!title) return button;
  return (
    <Tooltip
      title={title}
      {...tooltipProps}
      className={cn("pointer-events-none", tooltipProps?.className)}
    >
      {button}
    </Tooltip>
  );
}

/** Popup triggers recognize a native `<button>` by this name (see `nativeButton.ts`). */
ActionIcon.displayName = "ActionIcon";

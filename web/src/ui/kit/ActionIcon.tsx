import { Button, type ButtonProps } from "./Button";
import { cn } from "./cn";
import { Icon, type IconProps } from "./Icon";
import { Tooltip, type TooltipProps } from "./Tooltip";

/*
 * A borderless square Button with a tertiary glyph color. `small` and
 * `middle` are Button's sizes, 24 and 32, with glyphs 14 and 16; `bar`, 36
 * with glyph 20, stands alone in the shell's bars and floating toolbars. A
 * `title` wraps it in a tooltip.
 */

export type ActionIconSize = "small" | "middle" | "bar";

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
  middle: { button: "middle", className: undefined, glyph: 16 },
  bar: { button: "middle", className: "ui-action-icon-bar", glyph: 20 },
} as const;

export function ActionIcon({
  active,
  className,
  disabled,
  icon,
  size = "bar",
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
      type="text"
    />
  );
  if (!title) return button;
  return (
    <Tooltip title={title} {...tooltipProps}>
      {button}
    </Tooltip>
  );
}

/** Popup triggers recognize a native `<button>` by this name (see `nativeButton.ts`). */
ActionIcon.displayName = "ActionIcon";

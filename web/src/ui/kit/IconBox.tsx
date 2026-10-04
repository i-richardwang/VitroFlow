import { cn } from "./cn";
import { Icon, type IconProps } from "./Icon";

/*
 * An icon on a rounded square that marks what a row or page is about: 32
 * (`small`) in a table's name cell, 40 (`middle`) in a list row or before a
 * page title, 48 (`large`) for a row that leads with a larger mark. `primary`
 * draws it in the primary color on the primary background.
 */

export type IconBoxSize = "small" | "middle" | "large";

const SIZE = {
  small: { className: "ui-icon-box-small", glyph: 16 },
  middle: { className: "ui-icon-box-middle", glyph: 20 },
  large: { className: "ui-icon-box-large", glyph: 24 },
} satisfies Record<IconBoxSize, { className: string; glyph: number }>;

export function IconBox({
  icon,
  primary,
  size = "middle",
}: {
  icon: IconProps["icon"];
  primary?: boolean;
  size?: IconBoxSize;
}) {
  const preset = SIZE[size];
  return (
    <span
      aria-hidden
      className={cn(
        "ui-icon-box",
        preset.className,
        primary && "ui-icon-box-primary",
      )}
    >
      <Icon icon={icon} size={preset.glyph} />
    </span>
  );
}

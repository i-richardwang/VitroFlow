import { Icon, type IconProps } from "./Icon";

/*
 * An icon on a rounded tile that marks what kind of thing a card stands for.
 * `large` (40, glyph 22) leads a summary card in the info color on its fill;
 * `small` (32, glyph 16) leads a row, secondary on a fill.
 */
export function IconTile({
  icon,
  size = "large",
}: {
  icon: IconProps["icon"];
  size?: "small" | "large";
}) {
  return (
    <span aria-hidden className="ui-icon-tile" data-size={size}>
      <Icon icon={icon} size={size === "large" ? 22 : 16} />
    </span>
  );
}

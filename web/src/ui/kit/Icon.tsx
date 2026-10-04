import type { LucideIcon, LucideProps } from "lucide-react";
import {
  type ComponentProps,
  type FC,
  isValidElement,
  type ReactNode,
} from "react";
import { cn } from "./cn";

/*
 * A named size picks a preset edge and stroke, a number is pixels, an object
 * passes its own size and stroke through, and no size is 1em.
 */

export type IconSize =
  | "small"
  | "middle"
  | "large"
  | number
  | { size?: number | string; strokeWidth?: number | string };

export interface IconProps
  extends
    Omit<ComponentProps<"span">, "children" | "color" | "ref">,
    Pick<LucideProps, "fill" | "color"> {
  // Any component that takes lucide-style props.
  icon: LucideIcon | FC<LucideProps> | ReactNode;
  size?: IconSize;
  spin?: boolean;
}

const ICON_PRESET = { large: 24, middle: 20, small: 14 } as const;

function calcSize(size: IconSize | undefined): {
  size: number | string;
  strokeWidth?: number | string;
} {
  if (typeof size === "number") return { size };
  switch (size) {
    case "large":
    case "middle":
    case "small":
      return { size: ICON_PRESET[size], strokeWidth: 2 };
    case undefined:
      return { size: "1em", strokeWidth: 2 };
    default:
      return { size: size.size || 24, strokeWidth: size.strokeWidth || 2 };
  }
}

export function Icon({
  icon,
  size: iconSize,
  color,
  fill = "transparent",
  className,
  spin,
  ...props
}: IconProps) {
  const { size, strokeWidth } = calcSize(iconSize || undefined);
  const Svg = icon as LucideIcon;
  return (
    <span
      className={cn("ui-icon", spin && "ui-icon-spin", className)}
      role="img"
      {...props}
    >
      {icon &&
        (isValidElement(icon) ? (
          icon
        ) : (
          <Svg
            color={color}
            fill={fill}
            height={size}
            size={size}
            strokeWidth={strokeWidth}
            width={size}
          />
        ))}
    </span>
  );
}

/** The `icon` prop of buttons: an element is used as is, a component is drawn at `small`. */
export function resolveIcon(icon: LucideIcon | ReactNode): ReactNode {
  if (icon === undefined || icon === null) return null;
  if (
    isValidElement(icon) ||
    typeof icon === "string" ||
    typeof icon === "number"
  ) {
    return icon;
  }
  return <Icon icon={icon} size="small" />;
}

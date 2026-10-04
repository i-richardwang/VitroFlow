import type {
  CSSProperties,
  ElementType,
  HTMLAttributes,
  ReactNode,
  Ref,
} from "react";
import { cn } from "./cn";

/*
 * Layout props become `--ui-flex-*` variables on the element; Flex.css maps
 * them onto the matching properties. The default axis is vertical. A
 * horizontal box with a space-* distribution and no width takes 100% width.
 * Numbers are pixels.
 */

type ContentPosition =
  | "center"
  | "end"
  | "flex-end"
  | "flex-start"
  | "start"
  | "stretch"
  | "baseline";

export interface FlexboxProps extends HTMLAttributes<HTMLElement> {
  align?: ContentPosition;
  as?: ElementType;
  children?: ReactNode;
  flex?: number | string;
  gap?: number | string;
  height?: number | string;
  horizontal?: boolean;
  justify?: CSSProperties["justifyContent"];
  padding?: number | string;
  paddingBlock?: number | string;
  paddingInline?: number | string;
  ref?: Ref<HTMLElement>;
  width?: number | string;
  wrap?: CSSProperties["flexWrap"];
}

const cssValue = (value: number | string) =>
  typeof value === "number" ? `${value}px` : value;

const SPACE = ["space-between", "space-around", "space-evenly"];

export function Flexbox({
  flex,
  gap,
  horizontal,
  align,
  justify,
  height,
  width,
  padding,
  paddingInline,
  paddingBlock,
  as: Container = "div",
  className,
  style,
  children,
  wrap,
  ref,
  ...props
}: FlexboxProps) {
  const justifyContent = justify;
  const finalWidth =
    horizontal && !width && justifyContent && SPACE.includes(justifyContent)
      ? "100%"
      : width === undefined
        ? undefined
        : cssValue(width);

  const vars: Record<string, string> = {};
  if (flex !== undefined) vars["--ui-flex"] = String(flex);
  if (horizontal) vars["--ui-flex-direction"] = "row";
  if (wrap !== undefined) vars["--ui-flex-wrap"] = wrap;
  if (justifyContent !== undefined) vars["--ui-flex-justify"] = justifyContent;
  if (align !== undefined) vars["--ui-flex-align"] = align;
  if (finalWidth !== undefined) vars["--ui-flex-width"] = finalWidth;
  if (height !== undefined) vars["--ui-flex-height"] = cssValue(height);
  if (padding !== undefined) vars["--ui-flex-padding"] = cssValue(padding);
  if (paddingInline !== undefined)
    vars["--ui-flex-padding-inline"] = cssValue(paddingInline);
  if (paddingBlock !== undefined)
    vars["--ui-flex-padding-block"] = cssValue(paddingBlock);
  if (gap !== undefined) vars["--ui-flex-gap"] = cssValue(gap);

  return (
    <Container
      ref={ref}
      {...props}
      className={cn("ui-flex", className)}
      style={{ ...(vars as CSSProperties), ...style }}
    >
      {children}
    </Container>
  );
}

/** A Flexbox centered on both axes. */
export function Center(props: Omit<FlexboxProps, "align" | "justify">) {
  return <Flexbox {...props} align="center" justify="center" />;
}

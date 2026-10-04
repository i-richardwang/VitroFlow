import { isValidElement, type ReactNode } from "react";

/*
 * When a Base UI trigger renders as its child, Base UI needs to know whether
 * that element is a native `<button>`. Components are recognized by
 * `displayName` rather than imported, so popups and buttons do not import each
 * other. A new component that renders a native `<button>` joins this list and
 * sets its `displayName`.
 */

const NATIVE_BUTTON_COMPONENTS = new Set(["ActionIcon", "Button"]);

export function isNativeButtonElement(children: ReactNode): boolean {
  return isValidElement(children) && children.type === "button";
}

/** Passed to Base UI's `nativeButton`; non-elements are left to Base UI. */
export function resolveNativeButton(children: ReactNode): boolean | undefined {
  if (!isValidElement(children)) return undefined;
  if (typeof children.type === "string") return children.type === "button";
  const component = children.type as { displayName?: string };
  return NATIVE_BUTTON_COMPONENTS.has(component.displayName ?? "");
}

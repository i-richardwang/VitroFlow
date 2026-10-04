import { mergeProps } from "@base-ui/react/merge-props";
import { cloneElement, type ReactElement, type Ref } from "react";
import { isNativeButtonElement } from "./nativeButton";

/*
 * Shared by the popup components. Popups portal to `<body>` and share the
 * `--z-index-popup` step. Portals are appended to `<body>` in opening order,
 * so a later popup comes later in the document and covers earlier ones. The
 * container is always passed explicitly; otherwise Base UI nests a popup
 * inside the outer popup's portal.
 */

/** Where popups portal. Popups open only in the browser; the server has no document. */
export const defaultPortalContainer = (): HTMLElement | undefined =>
  typeof document === "undefined" ? undefined : document.body;

/** Combines refs so a trigger reaches the caller, the child itself and Base UI. */
export function mergeRefs<T>(refs: (Ref<T> | undefined)[]) {
  return (node: T | null) => {
    const cleanups = refs.map((ref) => {
      if (typeof ref === "function") return ref(node);
      if (ref) ref.current = node;
      return undefined;
    });
    return () => {
      refs.forEach((ref, i) => {
        const cleanup = cleanups[i];
        if (typeof cleanup === "function") cleanup();
        else if (typeof ref === "function") ref(null);
        else if (ref) ref.current = null;
      });
    };
  };
}

type TriggerChildProps = Record<string, unknown> & { ref?: Ref<never> };

/**
 * `render` for popup triggers: Base UI's props and ref merge into the child
 * itself. Base UI's `type="button"` goes only to a literal `<button>`; a
 * component child (Button, ActionIcon) uses `type` for its look and sets the
 * native type itself.
 */
export function triggerRender(children: ReactElement) {
  const child = children as ReactElement<TriggerChildProps>;
  return (props: object) => {
    const { ref, type, ...rest } = props as TriggerChildProps & {
      type?: string;
    };
    const own = isNativeButtonElement(child) ? { ...rest, type } : rest;
    return cloneElement(child, {
      ...(mergeProps(child.props, own) as TriggerChildProps),
      ref: mergeRefs([child.props.ref, ref]),
    });
  };
}

/**
 * Where a popup sits relative to its trigger: the first word is the side, the
 * second the end of that edge it aligns to (`bottomLeft` is below, left edges
 * aligned). A bare side is centered.
 */
export type Placement =
  "top" | "right" | "bottom" | "bottomLeft" | "bottomRight";

interface PlacementConfig {
  align: "start" | "center" | "end";
  side: "top" | "bottom" | "left" | "right";
}

export const placementMap: Record<Placement, PlacementConfig> = {
  bottom: { align: "center", side: "bottom" },
  bottomLeft: { align: "start", side: "bottom" },
  bottomRight: { align: "end", side: "bottom" },
  right: { align: "center", side: "right" },
  top: { align: "center", side: "top" },
};

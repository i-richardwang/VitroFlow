import type { Ref } from "react";

/** Combines refs into one callback ref that sets and clears each of them. */
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

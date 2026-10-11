import { useSyncExternalStore } from "react";

/*
 * Whether the boxes are locked against edits. Every visit begins locked;
 * unlocking holds from one image to the next until the page is loaded again.
 */

let locked = true;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function setEditLocked(next: boolean) {
  if (next === locked) return;
  locked = next;
  for (const listener of listeners) listener();
}

export function useEditLocked(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => locked,
    () => true,
  );
}

import { useMemo, useState } from "react";

export interface History<T> {
  canUndo: boolean;
  canRedo: boolean;
  /** Records the state being replaced; the redo stack is discarded. */
  record: (current: T) => void;
  /** Returns the state to restore, recording the current one for redo. */
  undo: (current: T) => T | null;
  redo: (current: T) => T | null;
}

/** Linear undo/redo over immutable snapshots of a value. */
export function useHistory<T>(): History<T> {
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);

  return useMemo<History<T>>(
    () => ({
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      record: (current) => {
        setPast((stack) => [...stack, current]);
        setFuture([]);
      },
      undo: (current) => {
        const previous = past.at(-1);
        if (previous === undefined) {
          return null;
        }
        setPast((stack) => stack.slice(0, -1));
        setFuture((stack) => [...stack, current]);
        return previous;
      },
      redo: (current) => {
        const next = future.at(-1);
        if (next === undefined) {
          return null;
        }
        setFuture((stack) => stack.slice(0, -1));
        setPast((stack) => [...stack, current]);
        return next;
      },
    }),
    [past, future],
  );
}

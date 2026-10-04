import type { Transition } from "motion/react";

/*
 * Durations and curves for motion come from the motion tokens in `app.css`.
 * Each token is read from the document once and kept, so calling these during
 * render costs no style recalculation and returns the same value every time.
 * On the server, or before the stylesheet has applied, a token reads empty, is
 * not kept, and motion's default applies for that transition.
 */

type Easing = [number, number, number, number];

const tokens = new Map<string, string>();

function read(token: string): string {
  const kept = tokens.get(token);
  if (kept !== undefined) return kept;
  if (typeof document === "undefined") return "";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  if (value) tokens.set(token, value);
  return value;
}

/** Tokens are milliseconds; motion takes seconds. */
function durationOf(token: string): number | undefined {
  const ms = Number.parseFloat(read(token));
  return Number.isFinite(ms) ? ms / 1000 : undefined;
}

function easeOf(token: string): Easing | undefined {
  const points = /^cubic-bezier\(([^)]+)\)$/
    .exec(read(token))?.[1]
    ?.split(",")
    .map(Number);
  return points?.length === 4 && points.every(Number.isFinite)
    ? (points as Easing)
    : undefined;
}

const PHASE_EASE = { enter: "--ease-soft", exit: "--ease-accelerate" } as const;

export const panelTransition = (
  component: "modal" | "drawer",
  phase: "enter" | "exit",
): Transition => ({
  duration: durationOf(`--duration-${component}-${phase}`),
  ease: easeOf(PHASE_EASE[phase]),
});

/** Width animation of a draggable panel folding and unfolding. */
export const foldTransition = (): Transition => ({
  duration: durationOf("--duration-panel-fold"),
  ease: easeOf("--ease-soft"),
});

export const backdropTransition = (): Transition => ({
  duration: durationOf("--duration-backdrop"),
  ease: easeOf("--ease-soft"),
});

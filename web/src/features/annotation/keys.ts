import { useEffect, useEffectEvent } from "react";

/** Open popups (a Select's options, a menu, a dialog) own the keys typed in them. */
const KEY_OWNERS =
  "[role='listbox'], [role='menu'], [role='dialog'], [role='alertdialog']";

/** A key typed into text or an open popup belongs there, not to the image. */
export function isOwnedKey(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable ||
      target.closest(KEY_OWNERS) !== null)
  );
}

/** Controls that answer Enter and the arrow keys themselves while focused. */
const KEY_HANDLERS = "button, a[href], input, select, textarea, [role]";

/**
 * Enter and the arrows move through the page's images, unless a control
 * holding focus answers them itself.
 */
export function useStepKeys(bindings: Partial<Record<StepKey, () => void>>) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    if (
      event.target instanceof HTMLElement &&
      event.target.closest(KEY_HANDLERS)
    ) {
      return;
    }
    const step = bindings[event.key as StepKey];
    if (!step) return;
    event.preventDefault();
    step();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}

type StepKey = "Enter" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

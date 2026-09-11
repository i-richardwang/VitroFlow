import { canonicalJson } from "../../lib/json/canonical";
import type { AnnotationInstance } from "./schema";

/** The unsaved calibration of an image's annotation. */
export interface AnnotationDraft {
  base: AnnotationInstance[] | null;
  instances: AnnotationInstance[];
  past: AnnotationInstance[][];
  future: AnnotationInstance[][];
  saving: boolean;
}

export type DraftAction =
  | { type: "replace"; instances: AnnotationInstance[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "submit" }
  | { type: "failed" };

/** A draft begins with the stored base, or detection boxes for a first review. */
export function openDraft(
  base: AnnotationInstance[] | null,
  detection: AnnotationInstance[],
): AnnotationDraft {
  return {
    base,
    instances: base ?? detection,
    past: [],
    future: [],
    saving: false,
  };
}

/** Submission freezes the draft, including replacements already queued by gestures. */
export function reduceDraft(
  state: AnnotationDraft,
  action: DraftAction,
): AnnotationDraft {
  if (action.type === "failed") return { ...state, saving: false };
  if (state.saving) return state;
  switch (action.type) {
    case "submit":
      return { ...state, saving: true };
    case "replace":
      if (canonicalJson(action.instances) === canonicalJson(state.instances))
        return state;
      return {
        ...state,
        instances: action.instances,
        past: [...state.past, state.instances],
        future: [],
      };
    case "undo": {
      const previous = state.past.at(-1);
      return previous
        ? {
            ...state,
            instances: previous,
            past: state.past.slice(0, -1),
            future: [...state.future, state.instances],
          }
        : state;
    }
    case "redo": {
      const next = state.future.at(-1);
      return next
        ? {
            ...state,
            instances: next,
            past: [...state.past, state.instances],
            future: state.future.slice(0, -1),
          }
        : state;
    }
  }
}

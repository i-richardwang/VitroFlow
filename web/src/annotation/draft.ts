import { canonicalJson } from "../json/canonical";
import type { AnnotationInstance } from "./schema";

/** One editing session of the boxes on an image. */
export interface AnnotationDraft {
  /** False until this session has read the stored annotation. */
  ready: boolean;
  base: AnnotationInstance[] | null;
  instances: AnnotationInstance[];
  past: AnnotationInstance[][];
  future: AnnotationInstance[][];
  saving: boolean;
}

export type DraftAction =
  | { type: "base"; base: AnnotationInstance[] | null }
  | { type: "edit"; instances: AnnotationInstance[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "submit" }
  | { type: "failed" };

/** Opens from the boxes on screen. Load the stored annotation next. */
export function openDraft(opening: AnnotationInstance[]): AnnotationDraft {
  return {
    ready: false,
    base: null,
    instances: opening,
    past: [],
    future: [],
    saving: false,
  };
}

/** Submission freezes the draft, including edits already queued by gestures. */
export function reduceDraft(
  state: AnnotationDraft,
  action: DraftAction,
): AnnotationDraft {
  if (action.type === "failed") return { ...state, saving: false };
  if (state.saving) return state;
  switch (action.type) {
    case "base": {
      if (state.ready) return state;
      const instances =
        state.past.length === 0
          ? (action.base ?? state.instances)
          : state.instances;
      return {
        ...state,
        ready: true,
        base: action.base,
        instances:
          canonicalJson(instances) === canonicalJson(state.instances)
            ? state.instances
            : instances,
      };
    }
    case "submit":
      if (!state.ready) return state;
      return { ...state, saving: true };
    case "edit":
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

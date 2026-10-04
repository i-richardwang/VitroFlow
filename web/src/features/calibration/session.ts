import { useBlocker, useRouter } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  openDraft,
  reduceDraft,
  type AnnotationDraft,
  type DraftState,
  type DraftAction,
} from "../../domain/annotation/draft";
import {
  availableSources,
  shownInstances,
  sourceInstances,
  type Review,
} from "../../domain/annotation/review";
import type {
  AnnotationInstance,
  ReviewSource,
} from "../../domain/annotation/schema";
import type { Model } from "../../domain/models/schema";
import { getAnnotation, saveAnnotation } from "../../functions/review";
import { m } from "../../paraglide/messages";
import { confirmDestructive } from "../../ui/confirmDestructive";
import { runAction, useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { classForShortcut, toolForShortcut, type Tool } from "./controls";

interface SessionState {
  draft: AnnotationDraft;
  tool: Tool;
  panning: boolean;
  selectedId: string | null;
  activeClass: string;
  /** A save found the stored review changed since the draft's base was read. */
  conflicted: boolean;
}

type SessionAction =
  | {
      type: "start";
      base: AnnotationInstance[] | null;
      start: DraftState;
      activeClass: string;
    }
  | { type: "stop" }
  | { type: "conflict" }
  | { type: "tool"; tool: Tool }
  | { type: "panning"; panning: boolean }
  | { type: "selectedId"; selectedId: string | null }
  | { type: "activeClass"; activeClass: string }
  | DraftAction;

function reduceSession(
  state: SessionState | null,
  action: SessionAction,
): SessionState | null {
  if (action.type === "start") {
    return {
      draft: openDraft(action.base, action.start),
      tool: "select",
      panning: false,
      selectedId: null,
      activeClass: action.activeClass,
      conflicted: false,
    };
  }
  if (action.type === "stop" || state === null) return null;
  switch (action.type) {
    case "conflict":
      return {
        ...state,
        conflicted: true,
        draft: reduceDraft(state.draft, { type: "failed" }),
      };
    case "restart":
      return {
        ...state,
        selectedId: null,
        draft: reduceDraft(state.draft, action),
      };
    case "tool":
      return { ...state, tool: action.tool };
    case "panning":
      return { ...state, panning: action.panning };
    case "selectedId":
      return { ...state, selectedId: action.selectedId };
    case "activeClass":
      return { ...state, activeClass: action.activeClass };
    default:
      return { ...state, draft: reduceDraft(state.draft, action) };
  }
}

export type Calibration =
  | { status: "idle" }
  | { status: "loading"; close: () => void }
  | {
      status: "ready";
      close: () => void;
      save: () => Promise<void>;
      saving: boolean;
      base: AnnotationInstance[] | null;
      instances: AnnotationInstance[];
      /** The reading the draft descends from. */
      origin: ReviewSource | null;
      tool: Tool;
      panning: boolean;
      selectedId: string | null;
      setSelectedId: (selectedId: string | null) => void;
      replaceInstances: (instances: AnnotationInstance[]) => void;
      setTool: (tool: Tool) => void;
      history: { canUndo: boolean; canRedo: boolean };
      undo: () => void;
      redo: () => void;
      deleteSelected: () => void;
      sources: ReviewSource[];
      restartFrom: (source: ReviewSource) => void;
      /** The class the picker shows: the selected box's, or the one new boxes take. */
      boxClass: string;
      changeClass: (name: string) => void;
      activeClass: string;
      /** Saving is refused until the draft is read again from the stored review. */
      conflict: { reload: () => void; reloading: boolean } | null;
    };

/**
 * The frame's calibration: idle until asked, loading until the stored
 * annotation matches this image and model, then a draft that begins from the
 * boxes the page was showing, with shortcuts and leave-blocking.
 */
export function useCalibrationSession({
  calibrating,
  review,
  source,
  model,
  onClose,
}: {
  calibrating: boolean;
  review: Review;
  source: ReviewSource | undefined;
  model: Model;
  onClose: () => void;
}): Calibration {
  const [loaded, setLoaded] = useState<{
    digest: string;
    modelId: string;
    base: AnnotationInstance[] | null;
  } | null>(null);
  const closeUnopened = useEffectEvent(onClose);
  const { digest, modelId } = review.ref;
  useEffect(() => {
    if (!calibrating) {
      setLoaded(null);
      return;
    }
    const opening = new AbortController();
    void runAction(
      () => getAnnotation({ data: { digest, modelId } }),
      m.calibration_open_failed(),
      opening.signal,
    ).then((result) => {
      if (opening.signal.aborted) return;
      if (result.ok) {
        setLoaded({ digest, modelId, base: result.value?.instances ?? null });
        return;
      }
      closeUnopened();
    });
    return () => opening.abort();
  }, [calibrating, digest, modelId]);

  const ready =
    calibrating &&
    loaded !== null &&
    loaded.digest === digest &&
    loaded.modelId === modelId;
  const [session, dispatch] = useReducer(reduceSession, null);
  if (ready && loaded && session === null) {
    dispatch({
      type: "start",
      base: loaded.base,
      start: {
        instances:
          source === "review"
            ? (loaded.base ?? [])
            : shownInstances(review, source),
        origin: source ?? null,
      },
      activeClass: model.classes[0]!,
    });
  } else if (!ready && session !== null) {
    dispatch({ type: "stop" });
  }

  const router = useRouter();
  const closing = useRef(false);
  useEffect(() => {
    if (calibrating) closing.current = false;
  }, [calibrating]);

  const close = useCallback(() => {
    closing.current = true;
    onClose();
  }, [onClose]);

  const draft = session?.draft;
  const instances = draft?.instances ?? [];
  const saving = draft?.saving === true;
  const dirty = (draft?.past.length ?? 0) > 0;
  const shouldBlockLeave = useCallback(
    () => session !== null && !closing.current && (saving || dirty),
    [session, saving, dirty],
  );
  const blocker = useBlocker({
    shouldBlockFn: shouldBlockLeave,
    enableBeforeUnload: shouldBlockLeave,
    withResolver: true,
  });

  // A navigation waiting on unsaved changes asks whether to discard them:
  // dismissing the question stays, discarding leaves, and saving stays and
  // withdraws the question.
  useEffect(() => {
    if (blocker.status !== "blocked") return;
    if (saving) {
      blocker.reset();
      return;
    }
    return confirmDestructive({
      title: m.calibration_discard_confirm(),
      content: m.calibration_discard_description(),
      confirmLabel: m.calibration_discard(),
      onConfirm: blocker.proceed,
      onCancel: blocker.reset,
    });
  }, [blocker, saving]);

  const selected =
    instances.find((instance) => instance.id === session?.selectedId) ?? null;

  const replaceInstances = useCallback(
    (next: AnnotationInstance[]) =>
      dispatch({ type: "replace", instances: next }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const setTool = useCallback(
    (tool: Tool) => dispatch({ type: "tool", tool }),
    [],
  );
  const setPanning = useCallback(
    (panning: boolean) => dispatch({ type: "panning", panning }),
    [],
  );
  const setSelectedId = useCallback(
    (selectedId: string | null) => dispatch({ type: "selectedId", selectedId }),
    [],
  );

  const deleteSelected = useCallback(() => {
    const selectedId = session?.selectedId;
    if (!selectedId) return;
    replaceInstances(
      instances.filter((instance) => instance.id !== selectedId),
    );
    dispatch({ type: "selectedId", selectedId: null });
  }, [instances, session?.selectedId, replaceInstances]);

  const changeClass = useCallback(
    (name: string) => {
      dispatch({ type: "activeClass", activeClass: name });
      if (!selected || selected.class === name) return;
      replaceInstances(
        instances.map((instance) =>
          instance.id === selected.id ? { ...instance, class: name } : instance,
        ),
      );
    },
    [instances, replaceInstances, selected],
  );

  const base = session?.draft.base ?? null;
  const restartFrom = useCallback(
    (from: ReviewSource) => {
      const next = from === "review" ? base : sourceInstances(review, from);
      if (next) dispatch({ type: "restart", instances: next, origin: from });
    },
    [base, review],
  );

  const clearSelection = useCallback(() => {
    dispatch({ type: "selectedId", selectedId: null });
    dispatch({ type: "tool", tool: "select" });
  }, []);

  const { run: runSave } = useAsyncAction();
  const save = useCallback(async () => {
    if (!draft || draft.saving) return;
    dispatch({ type: "submit" });
    const result = await runSave(
      () =>
        saveAnnotation({
          data: {
            ref: review.ref,
            base: draft.base,
            instances: draft.instances,
          },
        }),
      m.calibration_save_failed(),
    );
    if (!result.ok) {
      dispatch({ type: "failed" });
      return;
    }
    if (result.value.status === "conflict") {
      dispatch({ type: "conflict" });
      return;
    }
    await router.invalidate();
    close();
  }, [draft, review.ref, router, close, runSave]);

  const { busy: reloading, run } = useAsyncAction();
  /** Reads the stored review again; the draft restarts from it as a new base. */
  const reload = useCallback(
    () =>
      void run(async () => {
        const annotation = await getAnnotation({ data: { digest, modelId } });
        await router.invalidate();
        setLoaded({ digest, modelId, base: annotation?.instances ?? null });
        dispatch({ type: "stop" });
      }, m.calibration_reload_failed()),
    [run, digest, modelId, router],
  );

  useShortcuts({
    enabled: session !== null && !saving,
    onPanChange: setPanning,
    onToolChange: setTool,
    onEscape: clearSelection,
    onDelete: deleteSelected,
    onUndo: undo,
    onRedo: redo,
    classes: model.classes,
    onClassChange: changeClass,
  });

  if (!calibrating) return { status: "idle" };
  if (session === null) return { status: "loading", close };
  return {
    status: "ready",
    close,
    save,
    saving,
    instances,
    origin: session.draft.origin,
    base: session.draft.base,
    tool: session.tool,
    panning: session.panning,
    selectedId: session.selectedId,
    setSelectedId,
    replaceInstances,
    setTool,
    history: {
      canUndo: session.draft.past.length > 0,
      canRedo: session.draft.future.length > 0,
    },
    undo,
    redo,
    deleteSelected,
    sources: [
      ...(base ? (["review"] as const) : []),
      ...availableSources({ ...review, annotation: null }),
    ],
    restartFrom,
    boxClass: selected?.class ?? session.activeClass,
    changeClass,
    activeClass: session.activeClass,
    conflict: session.conflicted ? { reload, reloading } : null,
  };
}

/** Open popups (a Select's options, a menu, a dialog) own the keys typed in them. */
const KEY_OWNERS =
  "[role='listbox'], [role='menu'], [role='dialog'], [role='alertdialog']";

/** A key typed into text or an open popup belongs there, not to the editor. */
function isOwnedKey(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable ||
      target.closest(KEY_OWNERS) !== null)
  );
}

function useShortcuts({
  enabled,
  onPanChange,
  onToolChange,
  onEscape,
  onDelete,
  onUndo,
  onRedo,
  classes,
  onClassChange,
}: {
  enabled: boolean;
  onPanChange: (panning: boolean) => void;
  onToolChange: (tool: Tool) => void;
  onEscape: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  classes: readonly string[];
  onClassChange: (name: string) => void;
}) {
  useEffect(() => {
    if (!enabled) {
      onPanChange(false);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isOwnedKey(event.target) || event.altKey) return;
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          (event.shiftKey ? onRedo : onUndo)();
        }
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        onPanChange(true);
        return;
      }
      if (event.key === "Escape") {
        onEscape();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        onDelete();
        return;
      }
      const tool = toolForShortcut(event.key);
      if (tool) {
        onToolChange(tool);
        return;
      }
      const shortcutClass = classForShortcut(classes, event.key);
      if (shortcutClass) onClassChange(shortcutClass);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") onPanChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    enabled,
    onPanChange,
    onToolChange,
    onEscape,
    onDelete,
    onUndo,
    onRedo,
    classes,
    onClassChange,
  ]);
}

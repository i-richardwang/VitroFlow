import { toast } from "@heroui/react";
import { useBlocker, useRouter } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
} from "react";

import { instancesFromDetection } from "../../domain/annotation/detection";
import {
  openDraft,
  reduceDraft,
  type AnnotationDraft,
  type DraftAction,
} from "../../domain/annotation/draft";
import type { Review } from "../../domain/annotation/review";
import type { AnnotationInstance } from "../../domain/annotation/schema";
import type { Model } from "../../domain/models/schema";
import { getAnnotation, saveAnnotation } from "../../functions/review";
import { m } from "../../paraglide/messages";
import { errorMessage } from "../../ui/errors";
import { toolForShortcut, type Tool } from "./controls";

interface SessionState {
  draft: AnnotationDraft;
  tool: Tool;
  panning: boolean;
  selectedId: string | null;
  activeClass: string;
}

type SessionAction =
  | {
      type: "start";
      base: AnnotationInstance[] | null;
      detection: AnnotationInstance[];
      activeClass: string;
    }
  | { type: "stop" }
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
      draft: openDraft(action.base, action.detection),
      tool: "select",
      panning: false,
      selectedId: null,
      activeClass: action.activeClass,
    };
  }
  if (action.type === "stop" || state === null) return null;
  switch (action.type) {
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
      instances: AnnotationInstance[];
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
      restartFromDetection?: () => void;
      className: string;
      changeClass: (className: string) => void;
      activeClass: string;
      discard: { onStay: () => void; onLeave: () => void } | null;
    };

/**
 * The frame's calibration: idle until asked, loading until the stored
 * annotation matches this image and model, then a draft with shortcuts
 * and leave-blocking.
 */
export function useCalibrationSession({
  calibrating,
  review,
  model,
  onClose,
}: {
  calibrating: boolean;
  review: Review;
  model: Model;
  onClose: () => void;
}): Calibration {
  const [loaded, setLoaded] = useState<{
    digest: string;
    modelId: string;
    base: AnnotationInstance[] | null;
  } | null>(null);
  const failed = useEffectEvent((cause: unknown) => {
    toast.danger(m.workbench_open_failed(), {
      description: errorMessage(cause),
    });
    onClose();
  });
  const { digest, modelId } = review.ref;
  useEffect(() => {
    if (!calibrating) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    getAnnotation({ data: { digest, modelId } }).then(
      (annotation) => {
        if (!cancelled) {
          setLoaded({ digest, modelId, base: annotation?.instances ?? null });
        }
      },
      (cause: unknown) => {
        if (!cancelled) failed(cause);
      },
    );
    return () => {
      cancelled = true;
    };
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
      detection: review.detection
        ? instancesFromDetection(review.detection)
        : [],
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

  useEffect(() => {
    if (blocker.status === "blocked" && saving) blocker.reset();
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
    (className: string) => {
      dispatch({ type: "activeClass", activeClass: className });
      if (!selected || selected.class === className) return;
      replaceInstances(
        instances.map((instance) =>
          instance.id === selected.id
            ? { ...instance, class: className }
            : instance,
        ),
      );
    },
    [instances, replaceInstances, selected],
  );

  const { detection } = review;
  const restartFromDetection = useCallback(() => {
    if (!detection) return;
    replaceInstances(instancesFromDetection(detection));
    dispatch({ type: "selectedId", selectedId: null });
  }, [detection, replaceInstances]);

  const clearSelection = useCallback(() => {
    dispatch({ type: "selectedId", selectedId: null });
    dispatch({ type: "tool", tool: "select" });
  }, []);

  const save = useCallback(async () => {
    if (!draft || draft.saving) return;
    dispatch({ type: "submit" });
    try {
      const result = await saveAnnotation({
        data: { ref: review.ref, base: draft.base, instances: draft.instances },
      });
      if (result.status === "conflict") {
        toast.danger(m.workbench_save_conflict());
        dispatch({ type: "failed" });
        return;
      }
      try {
        await router.invalidate();
      } catch {
        toast.warning(m.workbench_saved_refresh_failed());
      }
      close();
    } catch (cause) {
      toast.danger(m.workbench_save_failed(), {
        description: errorMessage(cause),
      });
      dispatch({ type: "failed" });
    }
  }, [draft, review.ref, router, close]);

  useShortcuts({
    enabled: session !== null && !saving,
    onPanChange: setPanning,
    onToolChange: setTool,
    onEscape: clearSelection,
    onDelete: deleteSelected,
    onUndo: undo,
    onRedo: redo,
  });

  if (!calibrating) return { status: "idle" };
  if (session === null) return { status: "loading", close };
  return {
    status: "ready",
    close,
    save,
    saving,
    instances,
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
    restartFromDetection: detection ? restartFromDetection : undefined,
    className: selected?.class ?? session.activeClass,
    changeClass,
    activeClass: session.activeClass,
    discard:
      blocker.status === "blocked" && !saving
        ? { onStay: blocker.reset, onLeave: blocker.proceed }
        : null,
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
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
}: {
  enabled: boolean;
  onPanChange: (panning: boolean) => void;
  onToolChange: (tool: Tool) => void;
  onEscape: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  useEffect(() => {
    if (!enabled) {
      onPanChange(false);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.altKey) return;
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
      if (tool) onToolChange(tool);
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
  }, [enabled, onPanChange, onToolChange, onEscape, onDelete, onUndo, onRedo]);
}

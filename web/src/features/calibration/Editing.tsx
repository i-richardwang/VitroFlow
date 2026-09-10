import { InlineSelect } from "@heroui-pro/react/inline-select";
import {
  AlertDialog,
  Button,
  ButtonGroup,
  Kbd,
  ListBox,
  Separator,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  toast,
} from "@heroui/react";
import { useBlocker, useRouter } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import { errorMessage } from "../../ui/errors";
import type { Review } from "../../domain/annotation/review";
import type { AnnotationInstance } from "../../domain/annotation/schema";
import { instancesFromDetection } from "../../domain/annotation/detection";
import { getAnnotation, saveAnnotation } from "../../functions/review";
import {
  openDraft,
  reduceDraft,
  type AnnotationDraft,
  type DraftAction,
} from "../../domain/annotation/draft";
import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import { DeleteIcon, RedoIcon, RestartIcon, UndoIcon } from "../../ui/icons";
import {
  WorkbenchActions,
  WorkbenchInspector,
  WorkbenchToolbar,
} from "../../ui/shell/Workbench";
import { BoxLayer, EditableBoxLayer } from "./BoxLayer";
import { TOOL_SPECS, TOOLS, toolForShortcut, type Tool } from "./controls";
import { ReviewInspector } from "./ReviewInspector";
import type { CalibrationViewProps } from "./types";

export function Editing({
  model,
  review,
  display,
  context,
  opening,
  onClose,
}: CalibrationViewProps & {
  opening: AnnotationInstance[];
  onClose: () => void;
}) {
  const session = useEditing({ model, review, opening, onClose });
  const { saving } = session;
  return (
    <>
      <WorkbenchActions>
        <Button variant="tertiary" isDisabled={saving} onPress={session.close}>
          {m.cancel()}
        </Button>
        <Button
          variant="primary"
          isPending={!session.ready || saving}
          onPress={session.save}
        >
          {saving ? m.workbench_saving() : m.workbench_save()}
        </Button>
        <div inert={saving || undefined} className="contents">
          {context.menu}
        </div>
      </WorkbenchActions>
      <WorkbenchToolbar
        label={m.workbench_navigation_and_tools()}
        inert={saving || undefined}
      >
        {context.toolbar}
        {context.toolbar ? <Separator /> : null}
        <CalibrationTools
          tool={session.tool}
          history={session.history}
          canDelete={session.selectedId !== null}
          onToolChange={session.setTool}
          onUndo={session.undo}
          onRedo={session.redo}
          onDelete={session.deleteSelected}
          onRestart={session.restartFromDetection}
          classes={model.classes}
          className={session.className}
          onClassChange={session.changeClass}
        />
      </WorkbenchToolbar>
      <WorkbenchInspector>
        <ReviewInspector
          model={model}
          instances={session.instances}
          detection={review.detection}
          display={display}
          details={context.details}
        />
      </WorkbenchInspector>
      {saving ? (
        <BoxLayer
          image={review}
          instances={session.instances}
          layers={display.layers}
        />
      ) : (
        <EditableBoxLayer
          image={review}
          instances={session.instances}
          layers={display.layers}
          tool={session.tool}
          panning={session.panning}
          className={session.activeClass}
          selectedId={session.selectedId}
          onSelect={session.setSelectedId}
          onInstancesChange={session.replaceInstances}
        />
      )}
      {session.discard ? (
        <DiscardDraftDialog
          onStay={session.discard.onStay}
          onLeave={session.discard.onLeave}
        />
      ) : null}
    </>
  );
}

interface Session {
  draft: AnnotationDraft;
  tool: Tool;
  panning: boolean;
  selectedId: string | null;
  activeClass: string;
}

type SessionAction =
  | { type: "tool"; tool: Tool }
  | { type: "panning"; panning: boolean }
  | { type: "selectedId"; selectedId: string | null }
  | { type: "activeClass"; activeClass: string }
  | DraftAction;

function reduceSession(state: Session, action: SessionAction): Session {
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

function useEditing({
  opening,
  review,
  model,
  onClose,
}: {
  opening: AnnotationInstance[];
  review: Review;
  model: Model;
  onClose: () => void;
}) {
  const router = useRouter();
  const closing = useRef(false);
  const [session, dispatch] = useReducer(
    reduceSession,
    undefined,
    (): Session => ({
      draft: openDraft(opening),
      tool: "select",
      panning: false,
      selectedId: null,
      activeClass: model.classes[0]!,
    }),
  );

  const failed = useEffectEvent((cause: unknown) => {
    toast.danger(m.workbench_open_failed(), {
      description: errorMessage(cause),
    });
    onClose();
  });

  const { digest, modelId } = review.ref;
  useEffect(() => {
    let cancelled = false;
    getAnnotation({ data: { digest, modelId } }).then(
      (annotation) => {
        if (!cancelled) {
          dispatch({ type: "base", base: annotation?.instances ?? null });
        }
      },
      (cause: unknown) => {
        if (!cancelled) failed(cause);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [digest, modelId]);

  const close = useCallback(() => {
    closing.current = true;
    onClose();
  }, [onClose]);

  const draft = session.draft;
  const instances = draft.instances;
  const saving = draft.saving;
  const dirty = draft.past.length > 0;
  const shouldBlockLeave = useCallback(
    () => !closing.current && (saving || dirty),
    [saving, dirty],
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
    instances.find((instance) => instance.id === session.selectedId) ?? null;

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
    const selectedId = session.selectedId;
    if (!selectedId) return;
    replaceInstances(
      instances.filter((instance) => instance.id !== selectedId),
    );
    dispatch({ type: "selectedId", selectedId: null });
  }, [instances, session.selectedId, replaceInstances]);

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
    if (!draft.ready || draft.saving) return;
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
    enabled: !saving,
    onPanChange: setPanning,
    onToolChange: setTool,
    onEscape: clearSelection,
    onDelete: deleteSelected,
    onUndo: undo,
    onRedo: redo,
  });

  return {
    ready: session.draft.ready,
    saving,
    instances,
    close,
    save,
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

function CalibrationTools({
  tool,
  history,
  canDelete,
  onToolChange,
  onUndo,
  onRedo,
  onDelete,
  onRestart,
  classes,
  className,
  onClassChange,
}: {
  tool: Tool;
  history: { canUndo: boolean; canRedo: boolean };
  canDelete: boolean;
  onToolChange: (tool: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  /** Replaces every instance with what the detection found; present when there is one. */
  onRestart?: () => void;
  classes: string[];
  className: string;
  onClassChange: (className: string) => void;
}) {
  return (
    <>
      <ToggleButtonGroup
        aria-label={m.workbench_tool_label()}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={new Set([tool])}
        onSelectionChange={(keys) => {
          const key = [...keys][0];
          if (key === "select" || key === "add") onToolChange(key);
        }}
      >
        {TOOLS.map((id, index) => {
          const { label, shortcut, icon: Icon } = TOOL_SPECS[id];
          const name = label();
          return (
            <ShortcutTooltip key={id} label={name} shortcut={shortcut}>
              <ToggleButton id={id} isIconOnly aria-label={name}>
                {index > 0 ? <ToggleButtonGroup.Separator /> : null}
                <Icon />
              </ToggleButton>
            </ShortcutTooltip>
          );
        })}
      </ToggleButtonGroup>
      {classes.length > 1 ? <Separator /> : null}
      {classes.length > 1 ? (
        <InlineSelect
          aria-label={m.workbench_box_class()}
          selectedKey={className}
          onSelectionChange={(key) =>
            key !== null && onClassChange(String(key))
          }
        >
          <InlineSelect.Trigger>
            <InlineSelect.Value />
            <InlineSelect.Indicator />
          </InlineSelect.Trigger>
          <InlineSelect.Popover className="w-44">
            <ListBox>
              {classes.map((name) => (
                <ListBox.Item key={name} id={name} textValue={name}>
                  {name}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </InlineSelect.Popover>
        </InlineSelect>
      ) : null}
      <Separator />
      <ButtonGroup variant="tertiary">
        <ShortcutTooltip label={m.workbench_undo()} shortcut="⌘Z">
          <Button
            variant="tertiary"
            isIconOnly
            aria-label={m.workbench_undo()}
            isDisabled={!history.canUndo}
            onPress={onUndo}
          >
            <UndoIcon />
          </Button>
        </ShortcutTooltip>
        <ShortcutTooltip label={m.workbench_redo()} shortcut="⇧⌘Z">
          <Button
            variant="tertiary"
            isIconOnly
            aria-label={m.workbench_redo()}
            isDisabled={!history.canRedo}
            onPress={onRedo}
          >
            <ButtonGroup.Separator />
            <RedoIcon />
          </Button>
        </ShortcutTooltip>
        <ShortcutTooltip label={m.workbench_delete()} shortcut="⌫">
          <Button
            variant="tertiary"
            isIconOnly
            aria-label={m.workbench_delete()}
            isDisabled={!canDelete}
            onPress={onDelete}
          >
            <ButtonGroup.Separator />
            <DeleteIcon />
          </Button>
        </ShortcutTooltip>
      </ButtonGroup>
      {onRestart ? (
        <>
          <Separator />
          <Tooltip delay={0}>
            <Button
              variant="tertiary"
              isIconOnly
              aria-label={m.workbench_restart_from_detection()}
              onPress={onRestart}
            >
              <RestartIcon />
            </Button>
            <Tooltip.Content>
              {m.workbench_restart_from_detection()}
            </Tooltip.Content>
          </Tooltip>
        </>
      ) : null}
    </>
  );
}

function ShortcutTooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut: string;
  children: ReactNode;
}) {
  return (
    <Tooltip delay={0}>
      {children}
      <Tooltip.Content className="flex items-center gap-2">
        {label}
        <Kbd>{shortcut}</Kbd>
      </Tooltip.Content>
    </Tooltip>
  );
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

function DiscardDraftDialog({
  onStay,
  onLeave,
}: {
  onStay: () => void;
  onLeave: () => void;
}) {
  return (
    <AlertDialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onStay();
      }}
    >
      <AlertDialog.Backdrop>
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>
                {m.workbench_discard_confirm()}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Footer>
              <Button variant="tertiary" slot="close">
                {m.cancel()}
              </Button>
              <Button variant="danger" onPress={onLeave}>
                {m.workbench_discard()}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}

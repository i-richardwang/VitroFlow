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
  useState,
  type ReactNode,
} from "react";

import {
  reviewInstances,
  shownInstances,
  type Review,
  type ReviewVersion,
} from "../../annotation/review";
import type { AnnotationInstance } from "../../annotation/schema";
import { instancesFromDetection } from "../../annotation/detection";
import type { DetectionResult } from "../../detection/schema";
import { getAnnotation, saveAnnotation } from "../../functions/review";
import {
  openDraft,
  reduceDraft,
  type AnnotationDraft,
  type DraftAction,
} from "../../annotation/draft";
import { tally } from "../../models/metrics";
import { versionSlug, type Model } from "../../models/schema";
import { m } from "../../paraglide/messages";
import { QualityAlert } from "../DetectionQuality";
import { DeleteIcon, RedoIcon, RestartIcon, UndoIcon } from "../icons";
import {
  Workbench,
  WorkbenchActions,
  WorkbenchInspector,
  WorkbenchToolbar,
} from "../Workbench";
import { BoxLayer, EditableBoxLayer } from "./BoxLayer";
import { ImageViewport } from "./ImageViewport";
import {
  TOOL_SPECS,
  TOOLS,
  toolForShortcut,
  type LayerKey,
  type Tool,
} from "./controls";
import {
  LayersSection,
  Metrics,
  MetricsSection,
  Section,
  type Metric,
} from "./inspector";

const DEFAULT_LAYERS: LayerKey[] = ["boxes"];

/** What a page adds around the image: its own controls, navigation, and facts. */
export interface ImageWorkbenchContext {
  /** Beside Edit. Hidden while a session is open. */
  actions?: ReactNode;
  /** Last in the navbar. */
  menu?: ReactNode;
  /** Before the editing tools. */
  toolbar?: ReactNode;
  /** Between the metrics and the layers. */
  details?: ReactNode;
}

/**
 * One image reviewed for one model, wherever the page shows it.
 *
 * The workbench owns the frame and the slots around it. A session is a
 * draft of the boxes: Cancel and Done in the navbar, drawing tools on
 * the toolbar, and an editable layer over the image. The page keeps that
 * session in its address. The draft opens from the boxes already shown;
 * the stored annotation is read as the save base and is not replaced by
 * later route data. Done stores the draft; Cancel discards it.
 */
export function ImageWorkbench({
  title,
  model,
  review,
  editing,
  version = "review",
  onEditingChange,
  context = {},
}: {
  title: string;
  model: Model;
  review: Review;
  /** Opens the draft, once there is something to review. */
  editing: boolean;
  /** The boxes shown while not editing. */
  version?: ReviewVersion;
  onEditingChange: (editing: boolean) => void;
  context?: ImageWorkbenchContext;
}) {
  const [layers, setLayers] = useState<ReadonlySet<LayerKey>>(
    () => new Set(DEFAULT_LAYERS),
  );
  const display = { layers, onLayersChange: setLayers };
  const opening = reviewInstances(review);
  const session = useAnnotationSession({
    editing,
    opening,
    review,
    model,
    onClose: () => onEditingChange(false),
  });
  const saving = session?.saving ?? false;

  return (
    <Workbench title={title}>
      <WorkbenchActions>
        {session ? (
          <Button
            key="cancel"
            variant="tertiary"
            isDisabled={saving}
            onPress={session.close}
          >
            {m.cancel()}
          </Button>
        ) : null}
        <Button
          key="primary"
          variant="primary"
          isDisabled={!session && !opening}
          isPending={Boolean(session && (!session.ready || saving))}
          onPress={session ? session.done : () => onEditingChange(true)}
        >
          {session
            ? saving
              ? m.workbench_saving()
              : m.workbench_done()
            : m.workbench_edit()}
        </Button>
        {!session && context.actions}
        <div inert={saving || undefined} className="contents">
          {context.menu}
        </div>
      </WorkbenchActions>
      {context.toolbar || session ? (
        <WorkbenchToolbar
          label={
            session
              ? m.workbench_navigation_and_tools()
              : m.workbench_navigation()
          }
          inert={saving || undefined}
        >
          {context.toolbar}
          {session ? (
            <>
              {context.toolbar ? <Separator /> : null}
              <EditingTools
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
            </>
          ) : null}
        </WorkbenchToolbar>
      ) : null}
      <WorkbenchInspector>
        <ReviewInspector
          model={model}
          instances={session?.instances ?? review.annotation?.instances ?? null}
          detection={review.detection}
          display={display}
          details={context.details}
        />
      </WorkbenchInspector>
      <ImageViewport
        image={{
          digest: review.ref.digest,
          width: review.width,
          height: review.height,
        }}
        filename={review.filename}
      >
        {session && !saving ? (
          <EditableBoxLayer
            image={review}
            instances={session.instances}
            layers={display.layers}
            tool={session.tool}
            panning={session.panning}
            className={session.activeClass}
            selectedId={session.selectedId}
            onSelect={session.setSelectedId}
            onInstancesChange={session.editInstances}
          />
        ) : (
          <BoxLayer
            image={review}
            instances={session?.instances ?? shownInstances(review, version)}
            layers={display.layers}
          />
        )}
      </ImageViewport>
      {session?.discard ? (
        <DiscardDraftDialog
          onStay={session.discard.onStay}
          onLeave={session.discard.onLeave}
        />
      ) : null}
    </Workbench>
  );
}

interface Display {
  layers: ReadonlySet<LayerKey>;
  onLayersChange: (layers: Set<LayerKey>) => void;
}

function ReviewInspector({
  model,
  instances,
  detection,
  display,
  details,
}: {
  model: Model;
  /** The boxes of the review, or of the draft while editing. */
  instances: AnnotationInstance[] | null;
  detection: DetectionResult | null;
  display: Display;
  details?: ReactNode;
}) {
  return (
    <>
      <MetricsSection
        metrics={model.metrics}
        sources={[
          ...(instances
            ? [{ label: m.workbench_source_review(), tally: tally(instances) }]
            : []),
          ...(detection
            ? [
                {
                  label: m.workbench_source_detected(),
                  tally: tally(detection.instances),
                },
              ]
            : []),
        ]}
      />
      {details}
      <LayersSection
        layers={display.layers}
        onLayersChange={display.onLayersChange}
      />
      {detection ? (
        <Section title={m.workbench_section_detection()}>
          <Metrics rows={detectionMetrics(model.id, detection)} />
          <QualityAlert quality={detection.quality} />
        </Section>
      ) : null}
    </>
  );
}

function detectionMetrics(modelId: string, result: DetectionResult): Metric[] {
  const metrics = result.diagnostics?.metrics;
  const rows: Metric[] = [
    {
      label: m.workbench_detection_version(),
      value: versionSlug({ id: result.producer.modelVersionId, modelId }),
    },
  ];
  if (metrics?.confidence_threshold !== undefined) {
    rows.push({
      label: m.workbench_detection_threshold(),
      value: String(metrics.confidence_threshold),
    });
  }
  return rows;
}

interface Session {
  draft: AnnotationDraft;
  tool: Tool;
  panning: boolean;
  selectedId: string | null;
  activeClass: string;
}

type SessionAction =
  | {
      type: "start";
      opening: AnnotationInstance[];
      activeClass: string;
    }
  | { type: "stop" }
  | { type: "tool"; tool: Tool }
  | { type: "panning"; panning: boolean }
  | { type: "selectedId"; selectedId: string | null }
  | { type: "activeClass"; activeClass: string }
  | DraftAction;

function reduceSession(
  state: Session | null,
  action: SessionAction,
): Session | null {
  switch (action.type) {
    case "start":
      return {
        draft: openDraft(action.opening),
        tool: "select",
        panning: false,
        selectedId: null,
        activeClass: action.activeClass,
      };
    case "stop":
      return null;
    case "tool":
      return state ? { ...state, tool: action.tool } : null;
    case "panning":
      return state ? { ...state, panning: action.panning } : null;
    case "selectedId":
      return state ? { ...state, selectedId: action.selectedId } : null;
    case "activeClass":
      return state ? { ...state, activeClass: action.activeClass } : null;
    default:
      return state
        ? { ...state, draft: reduceDraft(state.draft, action) }
        : null;
  }
}

function useAnnotationSession({
  editing,
  opening,
  review,
  model,
  onClose,
}: {
  editing: boolean;
  opening: AnnotationInstance[] | null;
  review: Review;
  model: Model;
  onClose: () => void;
}) {
  const router = useRouter();
  const closing = useRef(false);
  const live = editing && opening !== null;
  const [session, dispatch] = useReducer(reduceSession, null);

  if (live && !session && opening) {
    closing.current = false;
    dispatch({
      type: "start",
      opening,
      activeClass: model.classes[0]!,
    });
  } else if (!live && session) {
    dispatch({ type: "stop" });
  }

  const failed = useEffectEvent((cause: unknown) => {
    toast.danger(m.workbench_open_failed(), {
      description: cause instanceof Error ? cause.message : String(cause),
    });
    onClose();
  });

  const { digest, modelId } = review.ref;
  useEffect(() => {
    if (!live) return;
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
  }, [live, digest, modelId]);

  const close = useCallback(() => {
    closing.current = true;
    onClose();
  }, [onClose]);

  const draft = session?.draft ?? null;
  const instances = draft?.instances ?? [];
  const saving = draft?.saving ?? false;
  const dirty = (draft?.past.length ?? 0) > 0;
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
    instances.find((instance) => instance.id === session?.selectedId) ?? null;

  const editInstances = useCallback(
    (next: AnnotationInstance[]) => dispatch({ type: "edit", instances: next }),
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
    editInstances(instances.filter((instance) => instance.id !== selectedId));
    dispatch({ type: "selectedId", selectedId: null });
  }, [instances, session?.selectedId, editInstances]);

  const changeClass = useCallback(
    (className: string) => {
      dispatch({ type: "activeClass", activeClass: className });
      if (!selected || selected.class === className) return;
      editInstances(
        instances.map((instance) =>
          instance.id === selected.id
            ? { ...instance, class: className }
            : instance,
        ),
      );
    },
    [instances, editInstances, selected],
  );

  const { detection } = review;
  const restartFromDetection = useCallback(() => {
    if (!detection) return;
    editInstances(instancesFromDetection(detection));
    dispatch({ type: "selectedId", selectedId: null });
  }, [detection, editInstances]);

  const clearSelection = useCallback(() => {
    dispatch({ type: "selectedId", selectedId: null });
    dispatch({ type: "tool", tool: "select" });
  }, []);

  const done = useCallback(async () => {
    if (!draft?.ready || draft.saving) return;
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
        description: cause instanceof Error ? cause.message : String(cause),
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

  if (!session) return null;

  return {
    ready: session.draft.ready,
    saving,
    instances,
    close,
    done,
    tool: session.tool,
    panning: session.panning,
    selectedId: session.selectedId,
    setSelectedId,
    editInstances,
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

function EditingTools({
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
  /** Replaces every box with what the detection found; present when there is one. */
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

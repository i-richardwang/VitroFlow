import { InlineSelect } from "@heroui-pro/react/inline-select";
import {
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
  useRef,
  useReducer,
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
  /** Controls beside the Edit button, put away while editing. */
  actions?: ReactNode;
  /** The page's own menu, last in the action area in both modes. */
  menu?: ReactNode;
  /** Toolbar items before the editing tools. */
  toolbar?: ReactNode;
  /** Inspector sections between the metrics and the layers. */
  details?: ReactNode;
}

/**
 * One image reviewed for one model, wherever the page shows it.
 *
 * The image sits in one viewport for both modes, so opening or closing the
 * editor changes what is drawn over it and what surrounds it, never where
 * it is. Viewing shows what is stored: the review, or the detection until
 * there is one. Editing opens a draft of the boxes; the page keeps that
 * flag in its address so a link can open straight into editing. Done stores
 * the draft as the review and the page reloads what it shows; Cancel
 * discards the draft.
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

  return (
    <Workbench title={title}>
      <ImageViewport
        image={{
          digest: review.ref.digest,
          width: review.width,
          height: review.height,
        }}
        filename={review.filename}
      >
        {editing && opening ? (
          <Editing
            key={`${review.ref.modelId}:${review.ref.digest}`}
            model={model}
            review={review}
            opening={opening}
            display={display}
            onClose={() => onEditingChange(false)}
            context={context}
          />
        ) : (
          <Viewing
            model={model}
            review={review}
            version={version}
            display={display}
            onEdit={opening ? () => onEditingChange(true) : undefined}
            context={context}
          />
        )}
      </ImageViewport>
    </Workbench>
  );
}

interface Display {
  layers: ReadonlySet<LayerKey>;
  onLayersChange: (layers: Set<LayerKey>) => void;
}

function Viewing({
  model,
  review,
  version,
  display,
  onEdit,
  context,
}: {
  model: Model;
  review: Review;
  version: ReviewVersion;
  display: Display;
  /** Present once there is something to review. */
  onEdit?: () => void;
  context: ImageWorkbenchContext;
}) {
  return (
    <>
      <WorkbenchActions>
        <Button variant="primary" isDisabled={!onEdit} onPress={onEdit}>
          {m.workbench_edit()}
        </Button>
        {context.actions}
        {context.menu}
      </WorkbenchActions>
      {context.toolbar ? (
        <WorkbenchToolbar label={m.workbench_navigation()}>
          {context.toolbar}
        </WorkbenchToolbar>
      ) : null}
      <WorkbenchInspector>
        <ReviewInspector
          model={model}
          instances={review.annotation?.instances ?? null}
          detection={review.detection}
          display={display}
          details={context.details}
        />
      </WorkbenchInspector>
      <BoxLayer
        image={review}
        instances={shownInstances(review, version)}
        layers={display.layers}
      />
    </>
  );
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

interface EditingProps {
  model: Model;
  review: Review;
  opening: AnnotationInstance[];
  display: Display;
  onClose: () => void;
  context: ImageWorkbenchContext;
}

/** Each editor reads its own base; route refreshes never replace an open draft. */
function Editing(props: EditingProps) {
  const [initial, setInitial] = useState<AnnotationDraft | null>(null);
  const { digest, modelId } = props.review.ref;
  const failed = useEffectEvent((cause: unknown) => {
    toast.danger(m.workbench_open_failed(), {
      description: cause instanceof Error ? cause.message : String(cause),
    });
    props.onClose();
  });
  const opened = useEffectEvent((base: AnnotationInstance[] | null) =>
    setInitial(openDraft(base, base ?? props.opening)),
  );
  useEffect(() => {
    let active = true;
    getAnnotation({ data: { digest, modelId } }).then(
      (annotation) => {
        if (active) opened(annotation?.instances ?? null);
      },
      (cause: unknown) => {
        if (active) failed(cause);
      },
    );
    return () => {
      active = false;
    };
  }, [digest, modelId]);

  return initial ? (
    <Editor {...props} initial={initial} />
  ) : (
    <>
      <WorkbenchActions>
        <Button variant="tertiary" onPress={props.onClose}>
          {m.cancel()}
        </Button>
        <Button variant="primary" isDisabled>
          {m.workbench_opening()}
        </Button>
      </WorkbenchActions>
      <WorkbenchInspector>
        <ReviewInspector
          model={props.model}
          instances={props.review.annotation?.instances ?? null}
          detection={props.review.detection}
          display={props.display}
          details={props.context.details}
        />
      </WorkbenchInspector>
      <BoxLayer
        image={props.review}
        instances={props.opening}
        layers={props.display.layers}
      />
    </>
  );
}

/** A locally edited draft is immutable while its single submission is pending. */
function Editor({
  model,
  review,
  initial,
  display,
  onClose,
  context,
}: Omit<EditingProps, "opening"> & { initial: AnnotationDraft }) {
  const router = useRouter();
  const [draft, dispatch] = useReducer(reduceDraft, initial);
  const { instances, saving } = draft;
  const history = {
    canUndo: draft.past.length > 0,
    canRedo: draft.future.length > 0,
  };
  const closing = useRef(false);
  const [tool, setTool] = useState<Tool>("select");
  const [panning, setPanning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeClass, setActiveClass] = useState(model.classes[0]!);

  const dirty = history.canUndo;
  useBlocker({
    shouldBlockFn: () =>
      !closing.current &&
      (saving || (dirty && !window.confirm(m.workbench_discard_confirm()))),
    enableBeforeUnload: () => (dirty || saving) && !closing.current,
  });

  const close = useCallback(() => {
    closing.current = true;
    onClose();
  }, [onClose]);

  const done = useCallback(async () => {
    if (saving) return;
    dispatch({ type: "submit" });
    try {
      const result = await saveAnnotation({
        data: { ref: review.ref, base: draft.base, instances },
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
  }, [review.ref, draft.base, instances, saving, router, close]);

  const selected =
    instances.find((instance) => instance.id === selectedId) ?? null;

  const editInstances = useCallback(
    (instances: AnnotationInstance[]) => dispatch({ type: "edit", instances }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    editInstances(instances.filter((instance) => instance.id !== selectedId));
    setSelectedId(null);
  }, [instances, selectedId, editInstances]);

  const changeClass = useCallback(
    (className: string) => {
      setActiveClass(className);
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
    setSelectedId(null);
  }, [detection, editInstances]);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setTool("select");
  }, []);

  useShortcuts({
    enabled: !saving,
    onPanChange: setPanning,
    onToolChange: setTool,
    onEscape: clearSelection,
    onDelete: deleteSelected,
    onUndo: undo,
    onRedo: redo,
  });

  return (
    <>
      <WorkbenchActions>
        <Button variant="tertiary" isDisabled={saving} onPress={close}>
          {m.cancel()}
        </Button>
        <Button variant="primary" isDisabled={saving} onPress={done}>
          {saving ? m.workbench_saving() : m.workbench_done()}
        </Button>
        <div inert={saving} className="contents">
          {context.menu}
        </div>
      </WorkbenchActions>
      <WorkbenchToolbar label={m.workbench_navigation_and_tools()}>
        <div inert={saving} className="contents">
          {context.toolbar}
          {context.toolbar ? <Separator /> : null}
          <EditingTools
            tool={tool}
            history={history}
            canDelete={selectedId !== null}
            onToolChange={setTool}
            onUndo={undo}
            onRedo={redo}
            onDelete={deleteSelected}
            onRestart={detection ? restartFromDetection : undefined}
            classes={model.classes}
            className={selected?.class ?? activeClass}
            onClassChange={changeClass}
          />
        </div>
      </WorkbenchToolbar>
      <WorkbenchInspector>
        <ReviewInspector
          model={model}
          instances={instances}
          detection={detection}
          display={display}
          details={context.details}
        />
      </WorkbenchInspector>
      {saving ? (
        <BoxLayer
          image={review}
          instances={instances}
          layers={display.layers}
        />
      ) : (
        <EditableBoxLayer
          image={review}
          instances={instances}
          layers={display.layers}
          tool={tool}
          panning={panning}
          className={activeClass}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onInstancesChange={editInstances}
        />
      )}
    </>
  );
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

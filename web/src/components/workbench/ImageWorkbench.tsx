import { InlineSelect } from "@heroui-pro/react/inline-select";
import {
  Alert,
  Button,
  ButtonGroup,
  Kbd,
  ListBox,
  Separator,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
} from "@heroui/react";
import { useBlocker, useRouter } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
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
import { reviewState, type AnnotationInstance } from "../../annotation/schema";
import { instancesFromDetection } from "../../annotation/detection";
import type { DetectionResult } from "../../detection/schema";
import { saveAnnotation } from "../../functions/review";
import { useHistory } from "../../hooks/useHistory";
import { tally } from "../../models/metrics";
import { versionSlug, type Model } from "../../models/schema";
import { QualityAlert } from "../DetectionQuality";
import { DeleteIcon, RedoIcon, RestartIcon, UndoIcon } from "../icons";
import { ReviewStateChip } from "../ReviewState";
import { Workbench } from "../Workbench";
import { AnnotationCanvas, type Editing } from "./AnnotationCanvas";
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
 * The page shows what is stored: the review, or the detection until one is.
 * Editing opens a draft of the boxes on the same canvas and adds the tools;
 * the page keeps that flag in its address so a link can open straight into
 * editing. Done stores the draft as the review and the page reloads what it
 * shows; Cancel discards the draft.
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

  if (editing && opening) {
    return (
      <Editor
        title={title}
        model={model}
        review={review}
        opening={opening}
        display={display}
        onClose={() => onEditingChange(false)}
        context={context}
      />
    );
  }

  return (
    <Workbench
      title={title}
      actions={
        <>
          <ReviewStateChip state={reviewState(review.annotation)} />
          <Button
            variant="primary"
            isDisabled={opening === null}
            onPress={() => onEditingChange(true)}
          >
            Edit
          </Button>
          {context.actions}
          {context.menu}
        </>
      }
      toolbar={
        context.toolbar ? (
          <Toolbar isAttached aria-label="Navigation">
            {context.toolbar}
          </Toolbar>
        ) : undefined
      }
      inspector={
        <ReviewInspector
          model={model}
          instances={review.annotation?.instances ?? null}
          detection={review.detection}
          display={display}
          details={context.details}
        />
      }
    >
      <ReviewCanvas
        review={review}
        instances={shownInstances(review, version)}
        layers={layers}
      />
    </Workbench>
  );
}

interface Display {
  layers: ReadonlySet<LayerKey>;
  onLayersChange: (layers: Set<LayerKey>) => void;
}

function ReviewCanvas({
  review,
  instances,
  layers,
  editing,
}: {
  review: Review;
  instances: AnnotationInstance[];
  layers: ReadonlySet<LayerKey>;
  editing?: Editing;
}) {
  return (
    <AnnotationCanvas
      image={{
        digest: review.ref.digest,
        width: review.width,
        height: review.height,
      }}
      filename={review.filename}
      instances={instances}
      layers={layers}
      editing={editing}
    />
  );
}

function ReviewInspector({
  model,
  instances,
  detection,
  display,
  details,
  children,
}: {
  model: Model;
  /** The boxes of the review, or of the draft while editing. */
  instances: AnnotationInstance[] | null;
  detection: DetectionResult | null;
  display: Display;
  details?: ReactNode;
  /** Notices that belong above everything, such as a failed save. */
  children?: ReactNode;
}) {
  return (
    <>
      {children}
      <MetricsSection
        metrics={model.metrics}
        sources={[
          ...(instances ? [{ label: "Review", tally: tally(instances) }] : []),
          ...(detection
            ? [{ label: "Detected", tally: tally(detection.instances) }]
            : []),
        ]}
      />
      {details}
      <LayersSection
        layers={display.layers}
        onLayersChange={display.onLayersChange}
      />
      {detection ? (
        <Section title="Detection">
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
      label: "Version",
      value: versionSlug({ id: result.producer.modelVersionId, modelId }),
    },
  ];
  if (metrics?.confidence_threshold !== undefined) {
    rows.push({
      label: "Threshold",
      value: String(metrics.confidence_threshold),
    });
  }
  return rows;
}

/**
 * A draft of the boxes, edited locally and stored once. The draft is dirty
 * while an edit can be undone; leaving with one asks first, whether by
 * navigation or by closing the tab.
 */
function Editor({
  title,
  model,
  review,
  opening,
  display,
  onClose,
  context,
}: {
  title: string;
  model: Model;
  review: Review;
  /** The boxes the draft begins from. */
  opening: AnnotationInstance[];
  display: Display;
  /** Called once the review is stored, or the draft discarded. */
  onClose: () => void;
  context: ImageWorkbenchContext;
}) {
  const router = useRouter();
  const [instances, setInstances] = useState(opening);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closing = useRef(false);
  const history = useHistory<AnnotationInstance[]>();
  const [tool, setTool] = useState<Tool>("select");
  const [panning, setPanning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeClass, setActiveClass] = useState(model.classes[0]!);

  const dirty = history.canUndo;
  useBlocker({
    shouldBlockFn: () =>
      dirty && !closing.current && !window.confirm("Discard unsaved changes?"),
    enableBeforeUnload: () => dirty && !closing.current,
  });

  const close = useCallback(() => {
    closing.current = true;
    onClose();
  }, [onClose]);

  const done = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await saveAnnotation({ data: { ref: review.ref, instances } });
      await router.invalidate();
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  }, [review.ref, instances, router, close]);

  const selected =
    instances.find((instance) => instance.id === selectedId) ?? null;

  const editInstances = useCallback(
    (next: AnnotationInstance[]) => {
      history.record(instances);
      setInstances(next);
    },
    [history, instances],
  );
  const undo = useCallback(() => {
    const previous = history.undo(instances);
    if (previous) setInstances(previous);
  }, [history, instances]);
  const redo = useCallback(() => {
    const next = history.redo(instances);
    if (next) setInstances(next);
  }, [history, instances]);

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
    onPanChange: setPanning,
    onToolChange: setTool,
    onEscape: clearSelection,
    onDelete: deleteSelected,
    onUndo: undo,
    onRedo: redo,
  });

  return (
    <Workbench
      title={title}
      actions={
        <>
          <Button variant="tertiary" isDisabled={saving} onPress={close}>
            Cancel
          </Button>
          <Button variant="primary" isDisabled={saving} onPress={done}>
            {saving ? "Saving…" : "Done"}
          </Button>
          {context.menu}
        </>
      }
      toolbar={
        <Toolbar isAttached aria-label="Navigation and tools">
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
        </Toolbar>
      }
      inspector={
        <ReviewInspector
          model={model}
          instances={instances}
          detection={review.detection}
          display={display}
          details={context.details}
        >
          {error ? (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Save failed</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
        </ReviewInspector>
      }
    >
      <ReviewCanvas
        review={review}
        instances={instances}
        layers={display.layers}
        editing={{
          tool,
          panning,
          className: activeClass,
          selectedId,
          onSelect: setSelectedId,
          onInstancesChange: editInstances,
        }}
      />
    </Workbench>
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
        aria-label="Tool"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={new Set([tool])}
        onSelectionChange={(keys) => {
          const key = [...keys][0];
          if (key === "select" || key === "add") onToolChange(key);
        }}
      >
        {TOOLS.map((id, index) => {
          const { label: name, shortcut, icon: Icon } = TOOL_SPECS[id];
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
          aria-label="Box class"
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
        <ShortcutTooltip label="Undo" shortcut="⌘Z">
          <Button
            variant="tertiary"
            isIconOnly
            aria-label="Undo"
            isDisabled={!history.canUndo}
            onPress={onUndo}
          >
            <UndoIcon />
          </Button>
        </ShortcutTooltip>
        <ShortcutTooltip label="Redo" shortcut="⇧⌘Z">
          <Button
            variant="tertiary"
            isIconOnly
            aria-label="Redo"
            isDisabled={!history.canRedo}
            onPress={onRedo}
          >
            <ButtonGroup.Separator />
            <RedoIcon />
          </Button>
        </ShortcutTooltip>
        <ShortcutTooltip label="Delete" shortcut="⌫">
          <Button
            variant="tertiary"
            isIconOnly
            aria-label="Delete"
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
              aria-label="Start again from detection"
              onPress={onRestart}
            >
              <RestartIcon />
            </Button>
            <Tooltip.Content>Start again from detection</Tooltip.Content>
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
  onPanChange,
  onToolChange,
  onEscape,
  onDelete,
  onUndo,
  onRedo,
}: {
  onPanChange: (panning: boolean) => void;
  onToolChange: (tool: Tool) => void;
  onEscape: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  useEffect(() => {
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
  }, [onPanChange, onToolChange, onEscape, onDelete, onUndo, onRedo]);
}

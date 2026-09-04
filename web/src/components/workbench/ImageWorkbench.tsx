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
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  reviewDocument,
  versionInstances,
  type Review,
  type ReviewVersion,
} from "../../annotation/review";
import type {
  AnnotationDocument,
  AnnotationInstance,
} from "../../annotation/schema";
import { documentFromDetection } from "../../annotation/detection";
import { reviewState } from "../../annotation/status";
import type { DetectionResult } from "../../detection/schema";
import { useAnnotation } from "../../hooks/useAnnotation";
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
 * The canvas shows the review document: the saved review, or a copy of the
 * detection until the first edit. Editing turns the same canvas editable
 * and adds the tools; the page keeps that flag in its address so a link can
 * open straight into editing. Every change is stored as it is made, and Done
 * marks the review complete.
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
  editing: boolean;
  /** The boxes shown while not editing. */
  version?: ReviewVersion;
  onEditingChange: (editing: boolean) => void;
  context?: ImageWorkbenchContext;
}) {
  const document = reviewDocument(review);
  const [layers, setLayers] = useState<ReadonlySet<LayerKey>>(
    () => new Set(DEFAULT_LAYERS),
  );
  const display = { layers, onLayersChange: setLayers };

  if (editing && document) {
    return (
      <Editor
        key={`${review.ref.digest}/${document.revision}`}
        title={title}
        model={model}
        review={review}
        opened={document}
        display={display}
        onDone={() => onEditingChange(false)}
        context={context}
      />
    );
  }

  return (
    <Workbench
      title={title}
      actions={
        <>
          <ReviewStateChip state={reviewState(document)} />
          <Button
            variant="primary"
            isDisabled={document === null}
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
          document={document}
          detection={review.detection}
          display={display}
          details={context.details}
        />
      }
    >
      <ReviewCanvas
        review={review}
        instances={versionInstances(review, version)}
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
  document,
  detection,
  display,
  details,
  children,
}: {
  model: Model;
  document: AnnotationDocument | null;
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
          ...(document
            ? [{ label: "Review", tally: tally(document.instances) }]
            : []),
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

function Editor({
  title,
  model,
  review,
  opened,
  display,
  onDone,
  context,
}: {
  title: string;
  model: Model;
  review: Review;
  /** The document the editor opens on, keyed by its revision by the caller. */
  opened: AnnotationDocument;
  display: Display;
  /** Called once the finished review is stored. */
  onDone: () => void;
  context: ImageWorkbenchContext;
}) {
  const { annotation, saveState, error, setInstances, finish, retry } =
    useAnnotation(review.ref, opened);
  const history = useHistory<AnnotationInstance[]>();
  const [tool, setTool] = useState<Tool>("select");
  const [panning, setPanning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeClass, setActiveClass] = useState(model.classes[0]!);

  const selected =
    annotation.instances.find((instance) => instance.id === selectedId) ?? null;

  const editInstances = useCallback(
    (instances: AnnotationInstance[]) => {
      history.record(annotation.instances);
      setInstances(instances);
    },
    [history, annotation.instances, setInstances],
  );
  const undo = useCallback(() => {
    const previous = history.undo(annotation.instances);
    if (previous) setInstances(previous);
  }, [history, annotation.instances, setInstances]);
  const redo = useCallback(() => {
    const next = history.redo(annotation.instances);
    if (next) setInstances(next);
  }, [history, annotation.instances, setInstances]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    editInstances(
      annotation.instances.filter((instance) => instance.id !== selectedId),
    );
    setSelectedId(null);
  }, [annotation.instances, selectedId, editInstances]);

  const changeClass = useCallback(
    (className: string) => {
      setActiveClass(className);
      if (!selected || selected.class === className) return;
      editInstances(
        annotation.instances.map((instance) =>
          instance.id === selected.id
            ? { ...instance, class: className }
            : instance,
        ),
      );
    },
    [annotation.instances, editInstances, selected],
  );

  const { detection } = review;
  const restartFromDetection = useCallback(() => {
    if (!detection) return;
    editInstances(documentFromDetection(detection).instances);
    setSelectedId(null);
  }, [detection, editInstances]);

  const cancelEditing = useCallback(() => {
    setSelectedId(null);
    setTool("select");
  }, []);

  useShortcuts({
    onPanChange: setPanning,
    onToolChange: setTool,
    onEscape: cancelEditing,
    onDelete: deleteSelected,
    onUndo: undo,
    onRedo: redo,
  });

  return (
    <Workbench
      title={title}
      actions={
        <>
          <Button
            variant="primary"
            onPress={async () => {
              if (await finish()) onDone();
            }}
          >
            Done
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
          document={annotation}
          detection={review.detection}
          display={display}
          details={context.details}
        >
          {saveState === "failed" ? (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Save failed</Alert.Title>
                {error ? <Alert.Description>{error}</Alert.Description> : null}
              </Alert.Content>
              <Button size="sm" variant="danger" onPress={retry}>
                Retry
              </Button>
            </Alert>
          ) : null}
        </ReviewInspector>
      }
    >
      <ReviewCanvas
        review={review}
        instances={annotation.instances}
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
      {onRestart ? <Separator /> : null}
      {onRestart ? (
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

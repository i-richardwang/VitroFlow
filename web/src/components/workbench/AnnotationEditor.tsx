import {
  Button,
  Kbd,
  ListBox,
  Select,
  Separator,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
} from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import type {
  AnnotationDocument,
  AnnotationRef,
  AnnotationInstance,
} from "../../annotation/schema";
import type { DetectionResult } from "../../detection/schema";
import { useAnnotation } from "../../hooks/useAnnotation";
import { useHistory } from "../../hooks/useHistory";
import type { Model } from "../../models/schema";
import { RedoIcon, UndoIcon } from "../icons";
import { QualityWarnings } from "../QualityWarnings";
import { AnnotationCanvas } from "./AnnotationCanvas";
import {
  TOOL_SPECS,
  TOOLS,
  toolForShortcut,
  type LayerKey,
  type Tool,
} from "./controls";
import { InspectorPanel } from "./InspectorPanel";
import { ReviewStatusMenu } from "./ReviewStatusMenu";
import { SaveIndicator } from "./SaveIndicator";
import { Workbench } from "../Workbench";

const DEFAULT_LAYERS: LayerKey[] = ["boxes", "dish"];

export function AnnotationEditor({
  subject,
  model,
  filename,
  result,
  annotation: initialAnnotation,
}: {
  subject: AnnotationRef;
  model: Model;
  filename: string;
  result: DetectionResult;
  annotation: AnnotationDocument;
}) {
  const { annotation, saveState, error, setInstances, review, retry } =
    useAnnotation(subject, initialAnnotation);
  const history = useHistory<AnnotationInstance[]>();
  const [tool, setTool] = useState<Tool>("select");
  const [panning, setPanning] = useState(false);
  const [layers, setLayers] = useState<ReadonlySet<LayerKey>>(
    () => new Set(DEFAULT_LAYERS),
  );
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
    if (previous) {
      setInstances(previous);
    }
  }, [history, annotation.instances, setInstances]);
  const redo = useCallback(() => {
    const next = history.redo(annotation.instances);
    if (next) {
      setInstances(next);
    }
  }, [history, annotation.instances, setInstances]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) {
      return;
    }
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
      title={`Review ${filename} for ${model.name}`}
      actions={
        <>
          <QualityWarnings quality={result.quality} />
          <SaveIndicator state={saveState} error={error} onRetry={retry} />
          <ReviewStatusMenu annotation={annotation} onReview={review} />
        </>
      }
      toolbar={
        <EditorToolbar
          tool={tool}
          history={history}
          onToolChange={setTool}
          onUndo={undo}
          onRedo={redo}
          classes={model.classes}
          className={selected?.class ?? activeClass}
          onClassChange={changeClass}
        />
      }
      inspector={
        <InspectorPanel
          model={model}
          result={result}
          annotation={annotation}
          layers={layers}
          onLayersChange={setLayers}
          selected={selected}
          onDeleteSelected={deleteSelected}
        />
      }
    >
      <AnnotationCanvas
        image={annotation.image}
        filename={filename}
        result={result}
        instances={annotation.instances}
        layers={layers}
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

function EditorToolbar({
  tool,
  history,
  onToolChange,
  onUndo,
  onRedo,
  classes,
  className,
  onClassChange,
}: {
  tool: Tool;
  history: { canUndo: boolean; canRedo: boolean };
  onToolChange: (tool: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  classes: string[];
  className: string;
  onClassChange: (className: string) => void;
}) {
  return (
    <Toolbar aria-label="Tools" className="px-3 py-1.5">
      <ToggleButtonGroup
        aria-label="Tool"
        size="sm"
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
                {index > 0 && <ToggleButtonGroup.Separator />}
                <Icon />
              </ToggleButton>
            </ShortcutTooltip>
          );
        })}
      </ToggleButtonGroup>
      <Separator orientation="vertical" className="mx-1 h-5" />
      {classes.length > 1 ? (
        <Select
          aria-label="Box class"
          className="w-44"
          variant="secondary"
          selectedKey={className}
          onSelectionChange={(key) =>
            key !== null && onClassChange(String(key))
          }
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {classes.map((name) => (
                <ListBox.Item key={name} id={name} textValue={name}>
                  {name}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      ) : null}
      {classes.length > 1 ? (
        <Separator orientation="vertical" className="mx-1 h-5" />
      ) : null}
      <ShortcutTooltip label="Undo" shortcut="⌘Z">
        <Button
          variant="tertiary"
          size="sm"
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
          size="sm"
          isIconOnly
          aria-label="Redo"
          isDisabled={!history.canRedo}
          onPress={onRedo}
        >
          <RedoIcon />
        </Button>
      </ShortcutTooltip>
    </Toolbar>
  );
}

function ShortcutTooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip delay={0}>
      <Tooltip.Trigger>{children}</Tooltip.Trigger>
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
      if (isTypingTarget(event.target) || event.altKey) {
        return;
      }
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
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") {
        onPanChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [onPanChange, onToolChange, onEscape, onDelete, onUndo, onRedo]);
}

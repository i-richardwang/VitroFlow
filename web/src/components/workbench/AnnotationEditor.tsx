import {
  Button,
  Kbd,
  Separator,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
} from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import type {
  AnnotationDocument,
  SeedInstance,
} from "../../annotation/schema";
import {
  IMAGE_KINDS,
  type ImageKind,
  type SeedResult,
} from "../../detection/schema";
import { useAnnotation } from "../../hooks/useAnnotation";
import { useHistory } from "../../hooks/useHistory";
import { RedoIcon, UndoIcon } from "../icons";
import { AnnotationCanvas } from "./AnnotationCanvas";
import {
  isEditableView,
  TOOL_SPECS,
  TOOLS,
  toolForShortcut,
  VIEW_LABELS,
  type LayerKey,
  type Tool,
} from "./controls";
import { InspectorPanel } from "./InspectorPanel";
import { ReviewStatusMenu } from "./ReviewStatusMenu";
import { SaveIndicator, WorkbenchTopBar } from "./WorkbenchTopBar";

const DEFAULT_LAYERS: LayerKey[] = ["boxes", "dish"];

export function AnnotationEditor({
  runId,
  stem,
  result,
  label,
}: {
  runId: string;
  stem: string;
  result: SeedResult;
  label: AnnotationDocument;
}) {
  const { annotation, saveState, error, setInstances, review, retry } =
    useAnnotation({ runId, stem }, label);
  const history = useHistory<SeedInstance[]>();
  const [view, setView] = useState<ImageKind>("source");
  const [tool, setTool] = useState<Tool>("select");
  const [panning, setPanning] = useState(false);
  const [layers, setLayers] = useState<ReadonlySet<LayerKey>>(
    () => new Set(DEFAULT_LAYERS),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected =
    annotation.instances.find((instance) => instance.id === selectedId) ?? null;

  const editInstances = useCallback(
    (instances: SeedInstance[]) => {
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

  const editable = isEditableView(view);

  return (
    <>
      <WorkbenchTopBar
        runId={runId}
        stem={stem}
        quality={result.quality}
        center={
          <ToggleButtonGroup
            aria-label="View"
            size="sm"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={new Set([view])}
            onSelectionChange={(keys) => setView([...keys][0] as ImageKind)}
          >
            {IMAGE_KINDS.map((kind) => (
              <ToggleButton key={kind} id={kind}>
                {VIEW_LABELS[kind]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        }
        trailing={
          <>
            <SaveIndicator state={saveState} error={error} onRetry={retry} />
            <ReviewStatusMenu annotation={annotation} onReview={review} />
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1">
          <AnnotationCanvas
            runId={runId}
            stem={stem}
            result={result}
            annotation={annotation}
            view={view}
            tool={tool}
            panning={panning}
            layers={layers}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onInstancesChange={editInstances}
            onDrawEnd={() => setTool("select")}
          />
          {editable && (
            <Toolbar
              isAttached
              aria-label="Tools"
              className="absolute top-3 left-3"
            >
              <ToggleButtonGroup
                aria-label="Tool"
                size="sm"
                selectionMode="single"
                disallowEmptySelection
                selectedKeys={new Set([tool])}
                onSelectionChange={(keys) => setTool([...keys][0] as Tool)}
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
              <ShortcutTooltip label="Undo" shortcut="⌘Z">
                <Button
                  variant="tertiary"
                  size="sm"
                  isIconOnly
                  aria-label="Undo"
                  isDisabled={!history.canUndo}
                  onPress={undo}
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
                  onPress={redo}
                >
                  <RedoIcon />
                </Button>
              </ShortcutTooltip>
            </Toolbar>
          )}
        </div>

        <InspectorPanel
          result={result}
          annotation={annotation}
          editable={editable}
          layers={layers}
          onLayersChange={setLayers}
          selected={selected}
          onDeleteSelected={deleteSelected}
        />
      </div>
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
  children: React.ReactNode;
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

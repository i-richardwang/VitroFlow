import {
  Kbd,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
} from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import type { AnnotationDocument } from "../../annotation/schema";
import {
  IMAGE_KINDS,
  type ImageKind,
  type SeedResult,
} from "../../detection/schema";
import { useAnnotation } from "../../hooks/useAnnotation";
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
    useAnnotation(stem, label);
  const [view, setView] = useState<ImageKind>("source");
  const [tool, setTool] = useState<Tool>("select");
  const [panning, setPanning] = useState(false);
  const [layers, setLayers] = useState<ReadonlySet<LayerKey>>(
    () => new Set(DEFAULT_LAYERS),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected =
    annotation.instances.find((instance) => instance.id === selectedId) ?? null;

  const deleteSelected = useCallback(() => {
    if (!selectedId) {
      return;
    }
    setInstances(
      annotation.instances.filter((instance) => instance.id !== selectedId),
    );
    setSelectedId(null);
  }, [annotation.instances, selectedId, setInstances]);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setTool("select");
  }, []);

  useShortcuts({
    onPanChange: setPanning,
    onToolChange: setTool,
    onEscape: clearSelection,
    onDelete: deleteSelected,
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
            onInstancesChange={setInstances}
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
                    <Tooltip key={id} delay={0}>
                      <ToggleButton id={id} isIconOnly aria-label={name}>
                        {index > 0 && <ToggleButtonGroup.Separator />}
                        <Icon />
                      </ToggleButton>
                      <Tooltip.Content className="flex items-center gap-2">
                        {name}
                        <Kbd>{shortcut}</Kbd>
                      </Tooltip.Content>
                    </Tooltip>
                  );
                })}
              </ToggleButtonGroup>
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
}: {
  onPanChange: (panning: boolean) => void;
  onToolChange: (tool: Tool) => void;
  onEscape: () => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        isTypingTarget(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
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
  }, [onPanChange, onToolChange, onEscape, onDelete]);
}

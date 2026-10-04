import { Redo2, RotateCcw, Trash2, Undo2 } from "lucide-react";

import type { ReviewSource } from "../../domain/annotation/schema";
import { m } from "../../paraglide/messages";
import { ActionIcon } from "../../ui/kit/ActionIcon";
import { DropdownMenu } from "../../ui/kit/DropdownMenu";
import { Select } from "../../ui/kit/Select";
import { ToolbarSeparator } from "../../ui/kit/Toolbar";
import {
  ClassLabel,
  classShortcut,
  TOOL_SPECS,
  TOOLS,
  type Tool,
} from "./controls";
import { sourceLabels } from "./labels";

export function CalibrationTools({
  tool,
  history,
  canDelete,
  onToolChange,
  onUndo,
  onRedo,
  onDelete,
  sources,
  onRestart,
  classes,
  boxClass,
  onClassChange,
}: {
  tool: Tool;
  history: { canUndo: boolean; canRedo: boolean };
  canDelete: boolean;
  onToolChange: (tool: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  sources: ReviewSource[];
  onRestart: (source: ReviewSource) => void;
  classes: string[];
  boxClass: string;
  onClassChange: (name: string) => void;
}) {
  return (
    <>
      <fieldset
        aria-label={m.calibration_tool_label()}
        className="flex gap-0.5"
      >
        {TOOLS.map((id) => {
          const { label, shortcut, icon } = TOOL_SPECS[id];
          return (
            <ActionIcon
              key={id}
              icon={icon}
              size="small"
              title={label()}
              tooltipProps={{ hotkey: shortcut, placement: "bottom" }}
              active={tool === id}
              aria-pressed={tool === id}
              onClick={() => onToolChange(id)}
            />
          );
        })}
      </fieldset>
      {classes.length > 1 ? (
        <>
          <ToolbarSeparator />
          <Select
            aria-label={m.calibration_box_class()}
            variant="borderless"
            size="small"
            value={boxClass}
            popupWidth="content"
            options={classes.map((name) => ({
              value: name,
              label: <ClassLabel classes={classes} name={name} />,
              hotkey: classShortcut(classes, name) ?? undefined,
            }))}
            onChange={onClassChange}
          />
        </>
      ) : null}
      <ToolbarSeparator />
      <ActionIcon
        icon={Undo2}
        size="small"
        title={m.calibration_undo()}
        tooltipProps={{ hotkey: "mod+z", placement: "bottom" }}
        disabled={!history.canUndo}
        onClick={onUndo}
      />
      <ActionIcon
        icon={Redo2}
        size="small"
        title={m.calibration_redo()}
        tooltipProps={{ hotkey: "shift+mod+z", placement: "bottom" }}
        disabled={!history.canRedo}
        onClick={onRedo}
      />
      <ActionIcon
        icon={Trash2}
        size="small"
        title={m.calibration_delete()}
        tooltipProps={{ hotkey: "backspace", placement: "bottom" }}
        disabled={!canDelete}
        onClick={onDelete}
      />
      {sources.length ? (
        <DropdownMenu
          align="end"
          items={sources.map((source) => ({
            key: source,
            label: m.calibration_restart_from({
              source: sourceLabels[source](),
            }),
            onClick: () => onRestart(source),
          }))}
        >
          <ActionIcon
            icon={RotateCcw}
            size="small"
            title={m.calibration_restart()}
            tooltipProps={{ placement: "bottom" }}
          />
        </DropdownMenu>
      ) : null}
    </>
  );
}

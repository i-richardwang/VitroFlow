import { InlineSelect } from "@heroui-pro/react/inline-select";
import {
  AlertDialog,
  Button,
  ButtonGroup,
  Dropdown,
  Kbd,
  Label,
  ListBox,
  Separator,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from "@heroui/react";
import type { ReactNode } from "react";

import type { ReviewSource } from "../../domain/annotation/review";
import { m } from "../../paraglide/messages";
import { DeleteIcon, RedoIcon, RestartIcon, UndoIcon } from "../../ui/icons";
import { TOOL_SPECS, TOOLS, type Tool } from "./controls";
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
  sources: ReviewSource[];
  onRestart: (source: ReviewSource) => void;
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
      {sources.length ? (
        <>
          <Separator />
          <Dropdown>
            <Tooltip delay={0}>
              <Button
                variant="tertiary"
                isIconOnly
                aria-label={m.workbench_restart()}
              >
                <RestartIcon />
              </Button>
              <Tooltip.Content>{m.workbench_restart()}</Tooltip.Content>
            </Tooltip>
            <Dropdown.Popover placement="bottom start">
              <Dropdown.Menu
                aria-label={m.workbench_restart()}
                onAction={(key) => onRestart(String(key) as ReviewSource)}
              >
                {sources.map((source) => (
                  <Dropdown.Item
                    key={source}
                    id={source}
                    textValue={m.workbench_restart_from({
                      source: sourceLabels[source](),
                    })}
                  >
                    <Label>
                      {m.workbench_restart_from({
                        source: sourceLabels[source](),
                      })}
                    </Label>
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
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

export function DiscardDraftDialog({
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

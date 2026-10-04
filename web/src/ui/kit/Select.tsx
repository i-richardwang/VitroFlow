import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown, X } from "lucide-react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { m } from "../../paraglide/messages";
import { cn } from "./cn";
import { defaultPortalContainer } from "./floating";
import { Icon } from "./Icon";

/*
 * A controlled select of one value from a flat list of options. Without a
 * `variant` the trigger is outlined in the light scheme and filled in the dark
 * one; CSS picks it from `.dark`. The popup reuses the menu blocks from
 * DropdownMenu.css.
 */

export type SelectSize = "middle" | "small";
export type SelectVariant = "borderless" | "filled";

export interface SelectOption<Value = string> {
  disabled?: boolean;
  label: ReactNode;
  value: Value;
}

interface SelectBaseProps<Value> {
  /** Accessible name of the trigger when no visible label is associated with it. */
  "aria-label"?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  labelRender?: (option: SelectOption<Value>) => ReactNode;
  optionRender?: (option: SelectOption<Value>) => ReactNode;
  options: SelectOption<Value>[];
  placeholder?: ReactNode;
  /** `false` lets the popup grow to its content instead of the trigger's width. */
  popupMatchSelectWidth?: boolean;
  size?: SelectSize;
  variant?: SelectVariant;
}

/** With `allowClear` a clear button empties the value and `onChange` receives `null`. */
export type SelectProps<Value = string> = SelectBaseProps<Value> &
  (
    | { allowClear?: false; onChange: (value: Value) => void; value: Value }
    | {
        allowClear: true;
        onChange: (value: Value | null) => void;
        value: Value | null;
      }
  );

const LIST_HEIGHT = 512;

const TRIGGER_SIZE = {
  middle: "ui-select-trigger-middle",
  small: "ui-select-trigger-small",
} as const;

const TRIGGER_VARIANT = {
  borderless: "ui-select-borderless",
  filled: "ui-select-filled",
} as const;

const searchText = <Value,>(option: SelectOption<Value>) =>
  typeof option.label === "string" || typeof option.label === "number"
    ? String(option.label)
    : String(option.value);

export function Select<Value = string>(props: SelectProps<Value>) {
  const {
    "aria-label": ariaLabel,
    className,
    disabled,
    id,
    labelRender,
    optionRender,
    options,
    placeholder,
    popupMatchSelectWidth = true,
    size = "middle",
    value,
    variant,
  } = props;

  const emit = (next: Value | null) => {
    if (props.allowClear) props.onChange(next);
    else if (next !== null) props.onChange(next);
  };

  const optionOf = (optionValue: Value): SelectOption<Value> =>
    options.find((option) => Object.is(option.value, optionValue)) ?? {
      label: String(optionValue),
      value: optionValue,
    };

  const renderValue = (current: Value | null): ReactNode => {
    if (current === null)
      return placeholder === undefined ? null : (
        <span className="ui-select-value-text">{placeholder}</span>
      );
    const option = optionOf(current);
    return (
      <span className="ui-select-value-text">
        {labelRender ? labelRender(option) : option.label}
      </span>
    );
  };

  const showClear = props.allowClear && value !== null && !disabled;

  const handleClear = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    emit(null);
  };

  const popupStyle = {
    maxWidth: "var(--available-width)",
    minWidth: popupMatchSelectWidth ? "var(--anchor-width)" : "max-content",
    "--ui-select-popup-max-height": `${LIST_HEIGHT}px`,
  } as CSSProperties;

  const itemTextClassName = cn(
    optionRender ? "ui-dropdown-menu-item-content" : "ui-dropdown-menu-label",
    "ui-select-item-text",
  );

  return (
    <BaseSelect.Root<Value>
      disabled={disabled}
      id={id}
      modal={false}
      value={value}
      onValueChange={emit}
    >
      <BaseSelect.Trigger
        aria-label={ariaLabel}
        className={cn(
          "ui-select-trigger",
          TRIGGER_SIZE[size],
          variant ? TRIGGER_VARIANT[variant] : "ui-select-auto",
          className,
        )}
        disabled={disabled}
      >
        <BaseSelect.Value className="ui-select-value">
          {renderValue}
        </BaseSelect.Value>
        <span className="ui-select-suffix">
          {showClear && (
            <span
              className="ui-select-clear"
              data-role="ui-select-clear"
              onClick={handleClear}
            >
              <Icon icon={X} size="small" />
            </span>
          )}
          <BaseSelect.Icon className="ui-select-icon">
            <Icon
              icon={ChevronDown}
              size="small"
              style={{ pointerEvents: "none" }}
            />
          </BaseSelect.Icon>
        </span>
      </BaseSelect.Trigger>

      <BaseSelect.Portal container={defaultPortalContainer()}>
        <BaseSelect.Positioner
          align="start"
          alignItemWithTrigger={false}
          className="ui-select-positioner"
          side="bottom"
          sideOffset={6}
        >
          <BaseSelect.Popup
            className={cn("ui-dropdown-menu-popup", "ui-select-popup")}
            style={popupStyle}
          >
            <BaseSelect.List className="ui-select-list">
              {options.length === 0 ? (
                <div
                  className={cn(
                    "ui-dropdown-menu-item",
                    "ui-dropdown-menu-empty",
                    "ui-select-empty",
                  )}
                >
                  {m.ui_no_data()}
                </div>
              ) : (
                options.map((option, index) => (
                  <BaseSelect.Item
                    className={cn("ui-dropdown-menu-item", "ui-select-item")}
                    disabled={option.disabled}
                    key={`${String(option.value)}-${index}`}
                    label={searchText(option)}
                    value={option.value}
                  >
                    <BaseSelect.ItemText className={itemTextClassName}>
                      {optionRender ? optionRender(option) : option.label}
                    </BaseSelect.ItemText>
                    <BaseSelect.ItemIndicator className="ui-select-item-indicator">
                      <Icon icon={Check} size="small" />
                    </BaseSelect.ItemIndicator>
                  </BaseSelect.Item>
                ))
              )}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

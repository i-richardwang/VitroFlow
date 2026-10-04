import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";

/* An exclusive group of compact toggles; once one is selected, clicking it again keeps it selected. */

export interface ToggleGroupOption<Value extends string> {
  disabled?: boolean;
  label: string;
  value: Value;
}

export interface ToggleGroupProps<Value extends string> {
  /** Accessible name of the group. */
  "aria-label": string;
  onChange: (value: Value) => void;
  options: ToggleGroupOption<Value>[];
  /** Nothing is selected while undefined. */
  value: Value | undefined;
}

export function ToggleGroup<Value extends string>({
  "aria-label": ariaLabel,
  onChange,
  options,
  value,
}: ToggleGroupProps<Value>) {
  return (
    <BaseToggleGroup<Value>
      aria-label={ariaLabel}
      className="ui-toggle-group"
      value={value === undefined ? [] : [value]}
      onValueChange={(next) => {
        const picked = next[0];
        if (picked !== undefined && picked !== value) onChange(picked);
      }}
    >
      {options.map((option) => (
        <Toggle<Value>
          className="ui-toggle-group-item"
          disabled={option.disabled}
          key={option.value}
          value={option.value}
        >
          {option.label}
        </Toggle>
      ))}
    </BaseToggleGroup>
  );
}

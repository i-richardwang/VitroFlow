import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { CheckboxGroup as BaseCheckboxGroup } from "@base-ui/react/checkbox-group";
import { CheckIcon, MinusIcon } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Text } from "./Text";

/*
 * Without children only the box renders. With children a `<label>` wraps box
 * and text; the text names the box even inside a field, whose label names the
 * group.
 */

const MARK = { size: 16, strokeWidth: 3, style: { transform: "scale(0.75)" } };

export interface CheckboxProps {
  "aria-label"?: string;
  checked?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  indeterminate?: boolean;
  name?: string;
  onChange?: (checked: boolean) => void;
  /** The value this box contributes inside a CheckboxGroup. */
  value?: string;
}

export function Checkbox({
  children,
  onChange,
  disabled,
  ...rest
}: CheckboxProps) {
  const textId = useId();

  const box = (
    <BaseCheckbox.Root
      aria-labelledby={children ? textId : undefined}
      className="ui-checkbox"
      disabled={disabled}
      onCheckedChange={onChange}
      {...rest}
    >
      <BaseCheckbox.Indicator
        className="ui-checkbox-indicator"
        render={(props, state) => (
          <span {...props}>
            {state.indeterminate ? (
              <MinusIcon {...MARK} />
            ) : (
              <CheckIcon {...MARK} />
            )}
          </span>
        )}
      />
    </BaseCheckbox.Root>
  );

  if (!children) return box;

  return (
    <label className="ui-checkbox-label">
      {box}
      <Text as="span" id={textId} type={disabled ? "secondary" : undefined}>
        {children}
      </Text>
    </label>
  );
}

export interface CheckboxGroupOption {
  label: ReactNode;
  value: string;
}

export interface CheckboxGroupProps {
  disabled?: boolean;
  onChange: (value: string[]) => void;
  /** Laid out in a wrapping row. */
  options: CheckboxGroupOption[];
  value: string[];
}

export function CheckboxGroup({
  disabled,
  onChange,
  options,
  value,
}: CheckboxGroupProps) {
  return (
    <BaseCheckboxGroup
      className="ui-checkbox-group"
      disabled={disabled}
      onValueChange={onChange}
      value={value}
    >
      {options.map((item) => (
        <Checkbox key={item.value} name={item.value} value={item.value}>
          {item.label}
        </Checkbox>
      ))}
    </BaseCheckboxGroup>
  );
}

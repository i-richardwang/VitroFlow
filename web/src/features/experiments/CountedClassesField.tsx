import { classColor } from "../../domain/models/classes";
import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import { CheckboxGroup } from "../../ui/kit/Checkbox";
import { ColorSwatch } from "../../ui/kit/ColorSwatch";
import { Form } from "../../ui/kit/Form";
import { className } from "../../ui/model-names";

/**
 * Which of its model's classes a day counts. A model with one class leaves
 * nothing to choose, and a day always counts at least one.
 */
export function CountedClassesField({
  disabled,
  model,
  value,
  onChange,
}: {
  disabled: boolean;
  model: Model;
  value: string[];
  onChange: (countedClasses: string[]) => void;
}) {
  if (model.classes.length < 2) return null;
  return (
    <Form.Field
      label={m.observation_counted_classes_label()}
      desc={m.observation_counted_classes_description()}
      required
      fieldset
    >
      <CheckboxGroup
        disabled={disabled}
        value={value}
        options={model.classes.map((name) => ({
          value: name,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <ColorSwatch color={classColor(model.classes, name).hex} />
              {className(name)}
            </span>
          ),
        }))}
        onChange={(next) => {
          if (next.length === 0) return;
          onChange(model.classes.filter((name) => next.includes(name)));
        }}
      />
    </Form.Field>
  );
}

import type { ModelAnnotation } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import { Form } from "../../ui/kit/Form";
import { Switch } from "../../ui/kit/Switch";

/** Whether AI annotation keeps to the dish, as a switch row in a dialog form. */
export function AnnotationAreaField({
  value,
  onChange,
  disabled,
}: {
  value: ModelAnnotation["area"];
  onChange: (area: ModelAnnotation["area"]) => void;
  disabled: boolean;
}) {
  return (
    <Form.Field
      layout="horizontal"
      label={m.model_annotation_dish_label()}
      desc={m.model_annotation_dish_description()}
    >
      <Switch
        checked={value === "dish"}
        onChange={(checked) => onChange(checked ? "dish" : "image")}
        disabled={disabled}
      />
    </Form.Field>
  );
}

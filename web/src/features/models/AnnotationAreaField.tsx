import { Checkbox, Description } from "@heroui/react";
import type { ModelAnnotation } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";

export function AnnotationAreaField({
  value,
  onChange,
  isDisabled,
}: {
  value: ModelAnnotation["area"];
  onChange: (area: ModelAnnotation["area"]) => void;
  isDisabled: boolean;
}) {
  return (
    <Checkbox
      isSelected={value === "dish"}
      onChange={(selected) => onChange(selected ? "dish" : "image")}
      isDisabled={isDisabled}
    >
      <Checkbox.Content>
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        {m.model_annotation_dish_label()}
      </Checkbox.Content>
      <Description>{m.model_annotation_dish_description()}</Description>
    </Checkbox>
  );
}

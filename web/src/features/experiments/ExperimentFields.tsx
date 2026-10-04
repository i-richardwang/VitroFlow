import type { CalendarDate } from "@internationalized/date";

import type { Experiment } from "../../domain/experiments/schema";
import { Form } from "../../ui/kit/Form";
import { Input, TextArea } from "../../ui/kit/Input";
import { m } from "../../paraglide/messages";
import { DayField } from "./DayField";

type NotebookPage = Pick<
  Experiment,
  "name" | "plantMaterial" | "explantType" | "baseMedium" | "notes"
>;

export function readExperimentFields(form: FormData): NotebookPage {
  const text = (field: string) => String(form.get(field) ?? "");
  return {
    name: text("name"),
    plantMaterial: text("plantMaterial"),
    explantType: text("explantType"),
    baseMedium: text("baseMedium"),
    notes: text("notes"),
  };
}

/** The notebook page of an experiment, read from the form by field name. */
export function ExperimentFields({
  disabled,
  defaults,
  inoculatedOn,
  onInoculatedOnChange,
}: {
  disabled: boolean;
  defaults?: NotebookPage;
  inoculatedOn: CalendarDate;
  onInoculatedOnChange: (value: CalendarDate) => void;
}) {
  return (
    <>
      <Form.Field
        name="name"
        label={m.experiment_field_name()}
        required
        validate={(value) =>
          String(value ?? "").trim() === ""
            ? m.experiment_field_name_required()
            : null
        }
      >
        <Input
          disabled={disabled}
          defaultValue={defaults?.name}
          placeholder={m.experiment_field_name_placeholder()}
        />
      </Form.Field>
      <div className="grid gap-4 mobile:grid-cols-2">
        <Form.Field
          className="min-w-0"
          name="plantMaterial"
          label={m.experiment_field_plant_material()}
        >
          <Input
            disabled={disabled}
            defaultValue={defaults?.plantMaterial}
            placeholder={m.experiment_field_plant_material_placeholder()}
          />
        </Form.Field>
        <Form.Field
          className="min-w-0"
          name="explantType"
          label={m.experiment_field_explant_type()}
        >
          <Input
            disabled={disabled}
            defaultValue={defaults?.explantType}
            placeholder={m.experiment_field_explant_type_placeholder()}
          />
        </Form.Field>
        <Form.Field
          className="min-w-0"
          name="baseMedium"
          label={m.experiment_field_base_medium()}
        >
          <Input
            disabled={disabled}
            defaultValue={defaults?.baseMedium}
            placeholder={m.experiment_field_base_medium_placeholder()}
          />
        </Form.Field>
        <DayField
          className="min-w-0"
          label={m.experiment_field_inoculated()}
          disabled={disabled}
          value={inoculatedOn}
          onChange={onInoculatedOnChange}
        />
      </div>
      <Form.Field name="notes" label={m.experiment_field_notes()}>
        <TextArea
          disabled={disabled}
          defaultValue={defaults?.notes}
          autoSize={{ minRows: 3, maxRows: 8 }}
        />
      </Form.Field>
    </>
  );
}

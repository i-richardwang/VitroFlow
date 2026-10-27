import type {
  TrainingOverrides,
  TrainingParameters,
} from "../../domain/training/parameters";
import { m } from "../../paraglide/messages";
import { Form } from "../../ui/kit/Form";
import { InputNumber } from "../../ui/kit/Input";
import { Text } from "../../ui/kit/Text";
import { PARAMETER_FIELDS, type ParameterField } from "./parameter-fields";

interface ParameterInputsProps {
  parameters: TrainingParameters;
  overrides: TrainingOverrides;
  onChange: (value: TrainingOverrides) => void;
  disabled: boolean;
}

/** Display resolved values while retaining only the user's adjustments. */
export function TrainingParametersForm(props: ParameterInputsProps) {
  return (
    <>
      <Form.Group title={m.parameter_group_training()}>
        <ParameterInputs
          {...props}
          fields={PARAMETER_FIELDS.filter((field) => !field.advanced)}
        />
      </Form.Group>
      <details>
        <summary>{m.train_advanced_parameters()}</summary>
        <Text size="sm" type="secondary">
          {m.train_advanced_help()}
        </Text>
        <ParameterInputs
          {...props}
          fields={PARAMETER_FIELDS.filter((field) => field.advanced)}
        />
      </details>
    </>
  );
}

function ParameterInputs({
  parameters,
  overrides,
  onChange,
  disabled,
  fields,
}: ParameterInputsProps & { fields: ParameterField[] }) {
  return (
    <div className="grid gap-4 mobile:grid-cols-2">
      {fields.map((field) => (
        <Form.Field
          key={field.key}
          label={field.label()}
          desc={
            parameters[field.key] === undefined
              ? m.parameter_runtime_default()
              : undefined
          }
        >
          <InputNumber
            value={overrides[field.key] ?? parameters[field.key] ?? null}
            min={field.min}
            max={field.max}
            step={field.step}
            format={{ maximumFractionDigits: 5 }}
            disabled={disabled}
            onChange={(value) => {
              const next = { ...overrides };
              if (value === null || value === parameters[field.key])
                delete next[field.key];
              else next[field.key] = value;
              onChange(next);
            }}
          />
        </Form.Field>
      ))}
    </div>
  );
}

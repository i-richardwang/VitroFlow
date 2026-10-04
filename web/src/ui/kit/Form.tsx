import { Field } from "@base-ui/react/field";
import { Fieldset } from "@base-ui/react/fieldset";
import { Form as BaseForm } from "@base-ui/react/form";
import { cloneElement, isValidElement, type ReactNode } from "react";
import { cn } from "./cn";

/*
 * A native `<form>` built on Base UI Form. Fields are plain controls that carry
 * a `name`; errors reach a field from its own validation, from Zod through
 * `validate`, or from the server through the form's `errors` map, keyed by
 * field name. Fields stack 16px apart, each with its label above the control;
 * with `layout="horizontal"` the label starts the row and the control ends it.
 */

export interface FormProps extends Omit<BaseForm.Props, "className"> {
  className?: string;
}

function FormRoot({ className, ...rest }: FormProps) {
  return <BaseForm className={cn("ui-form", className)} {...rest} />;
}

/**
 * A label with an optional line of description under it. It is built from
 * phrasing content, so it can sit inside a `<label>`.
 */
function FormTitle({ title, desc }: { desc?: ReactNode; title: ReactNode }) {
  return (
    <span className="ui-form-title">
      <span className="ui-form-title-title">{title}</span>
      {desc && <small className="ui-form-title-desc">{desc}</small>}
    </span>
  );
}

export interface FormFieldProps extends Omit<
  Field.Root.Props,
  "render" | "children" | "className"
> {
  children?: ReactNode;
  className?: string;
  /** A line of description under the label. */
  desc?: ReactNode;
  /** Names a group of controls, such as a CheckboxGroup, with a legend instead of a label. */
  fieldset?: boolean;
  label: ReactNode;
  layout?: "horizontal" | "vertical";
  /** Marks the label and passes `required` to the control; a fieldset only marks its legend. */
  required?: boolean;
}

function FormField({
  children,
  className,
  desc,
  fieldset,
  label,
  layout = "vertical",
  required,
  ...rest
}: FormFieldProps) {
  const FieldLabel = fieldset ? Fieldset.Legend : Field.Label;

  const control =
    required &&
    !fieldset &&
    isValidElement<{ required?: boolean }>(children) &&
    children.props.required === undefined
      ? cloneElement(children, { required: true })
      : children;

  return (
    <Field.Root
      className={cn(
        "ui-form-field",
        layout === "vertical"
          ? "ui-form-field-vertical"
          : "ui-form-field-horizontal",
        className,
      )}
      render={fieldset ? <Fieldset.Root /> : undefined}
      {...rest}
    >
      <FieldLabel className="ui-form-field-label">
        <FormTitle
          desc={desc}
          title={
            required ? (
              <span>
                <span aria-hidden className="ui-form-field-required">
                  *
                </span>
                {label}
              </span>
            ) : (
              label
            )
          }
        />
      </FieldLabel>
      <div
        className={cn(
          "ui-form-field-control",
          layout === "vertical" && "ui-form-field-control-vertical",
        )}
      >
        {control}
        <Field.Error className="ui-form-field-error" />
      </div>
    </Field.Root>
  );
}

export const Form = Object.assign(FormRoot, {
  Field: FormField,
  Title: FormTitle,
});

import { MIN_PASSWORD_LENGTH } from "../../domain/auth/schema";
import { Form } from "../../ui/kit/Form";
import { InputPassword } from "../../ui/kit/Input";

export function PasswordField({
  label,
  description,
  disabled,
  name = "password",
  autoComplete = "new-password",
  autoFocus,
}: {
  label: string;
  description?: string;
  disabled: boolean;
  name?: string;
  autoComplete?: "current-password" | "new-password";
  autoFocus?: boolean;
}) {
  return (
    <Form.Field label={label} desc={description} name={name} required>
      <InputPassword
        name={name}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        disabled={disabled}
        minLength={MIN_PASSWORD_LENGTH}
      />
    </Form.Field>
  );
}

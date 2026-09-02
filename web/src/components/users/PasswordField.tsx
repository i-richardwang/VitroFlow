import { FieldError, Input, Label, TextField } from "@heroui/react";

import { MIN_PASSWORD_LENGTH } from "../../auth/schema";

export function PasswordField({
  label,
  isDisabled,
  name = "password",
  autoComplete = "new-password",
  isInvalid = false,
  errorMessage,
  variant = "primary",
}: {
  label: string;
  isDisabled: boolean;
  name?: string;
  autoComplete?: "current-password" | "new-password";
  isInvalid?: boolean;
  errorMessage?: string;
  variant?: "primary" | "secondary";
}) {
  return (
    <TextField
      variant={variant}
      fullWidth
      isRequired
      isDisabled={isDisabled}
      isInvalid={isInvalid}
      name={name}
      type="password"
      minLength={MIN_PASSWORD_LENGTH}
    >
      <Label>{label}</Label>
      <Input className="w-full" autoComplete={autoComplete} />
      <FieldError>{errorMessage}</FieldError>
    </TextField>
  );
}

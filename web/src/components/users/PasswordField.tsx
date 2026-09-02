import {
  Description,
  FieldError,
  Input,
  Label,
  TextField,
} from "@heroui/react";

import { MIN_PASSWORD_LENGTH } from "../../auth/schema";

export function PasswordField({
  label,
  isDisabled,
  name = "password",
  autoComplete = "new-password",
  isInvalid = false,
  errorMessage,
}: {
  label: string;
  isDisabled: boolean;
  name?: string;
  autoComplete?: "current-password" | "new-password";
  isInvalid?: boolean;
  errorMessage?: string;
}) {
  return (
    <TextField
      variant="secondary"
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
      {errorMessage ? (
        <FieldError>{errorMessage}</FieldError>
      ) : (
        <Description>At least {MIN_PASSWORD_LENGTH} characters.</Description>
      )}
    </TextField>
  );
}

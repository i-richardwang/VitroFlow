import { Label, ListBox, Select } from "@heroui/react";

import { USER_ROLES, type UserRole } from "../../domain/auth/schema";
import { USER_ROLE_LABELS } from "../../ui/user-roles";
import { m } from "../../paraglide/messages";

export function RoleSelect({
  value,
  onChange,
  isDisabled,
}: {
  value: UserRole;
  onChange: (role: UserRole) => void;
  isDisabled: boolean;
}) {
  return (
    <Select
      variant="secondary"
      fullWidth
      isDisabled={isDisabled}
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key) as UserRole)}
    >
      <Label>{m.role_label()}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {USER_ROLES.map((role) => (
            <ListBox.Item
              key={role}
              id={role}
              textValue={USER_ROLE_LABELS[role]()}
            >
              {USER_ROLE_LABELS[role]()}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

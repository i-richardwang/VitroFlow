import { Label, ListBox, Select } from "@heroui/react";

import { USER_ROLES, USER_ROLE_LABELS, type UserRole } from "../../auth/schema";

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
      <Label>Role</Label>
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
              textValue={USER_ROLE_LABELS[role]}
            >
              {USER_ROLE_LABELS[role]}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

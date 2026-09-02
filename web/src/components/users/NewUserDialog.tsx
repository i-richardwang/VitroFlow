import {
  Button,
  Description,
  Form,
  Input,
  Label,
  Modal,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { UserRole } from "../../auth/schema";
import { addUser } from "../../functions/users";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { PasswordField } from "./PasswordField";
import { RoleSelect } from "./RoleSelect";

export function NewUserDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Editor
      key={isOpen ? "open" : "closed"}
      isOpen={isOpen}
      onClose={onClose}
    />
  );
}

function Editor({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [role, setRole] = useState<UserRole>("member");

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>New user</Modal.Heading>
              <Description>
                Share the initial password directly. They can replace it from
                their Account page after signing in.
              </Description>
            </Modal.Header>
            <Modal.Body>
              <Form
                id="new-user"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const name = String(form.get("name") ?? "");
                  void run(
                    () =>
                      addUser({
                        data: {
                          name,
                          email: String(form.get("email") ?? ""),
                          password: String(form.get("password") ?? ""),
                          role,
                        },
                      }),
                    "User not added",
                  ).then(async (result) => {
                    if (!result.ok) return;
                    toast.success(`${result.value.name} added`);
                    onClose();
                    await router.invalidate();
                  });
                }}
              >
                <TextField
                  variant="secondary"
                  fullWidth
                  isRequired
                  isDisabled={busy}
                  name="name"
                  autoFocus
                >
                  <Label>Name</Label>
                  <Input className="w-full" autoComplete="off" />
                </TextField>
                <TextField
                  variant="secondary"
                  fullWidth
                  isRequired
                  isDisabled={busy}
                  name="email"
                  type="email"
                >
                  <Label>Email</Label>
                  <Input className="w-full" autoComplete="off" />
                </TextField>
                <PasswordField label="Initial password" isDisabled={busy} />
                <RoleSelect value={role} onChange={setRole} isDisabled={busy} />
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="new-user"
                variant="primary"
                isDisabled={busy}
              >
                {busy ? "Adding…" : "Add"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

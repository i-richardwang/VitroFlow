import {
  Button,
  Form,
  Input,
  Label,
  Modal,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { UserRole } from "../../domain/auth/schema";
import { addUser } from "../../functions/users";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
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
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>{m.user_dialog_new_title()}</Modal.Heading>
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
                    m.user_not_added(),
                  ).then(async (result) => {
                    if (!result.ok) return;
                    toast.success(m.user_added({ name: result.value.name }));
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
                  <Label>{m.user_dialog_name_label()}</Label>
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
                  <Label>{m.user_dialog_email_label()}</Label>
                  <Input className="w-full" autoComplete="off" />
                </TextField>
                <PasswordField
                  label={m.user_dialog_initial_password_label()}
                  isDisabled={busy}
                  variant="secondary"
                />
                <RoleSelect value={role} onChange={setRole} isDisabled={busy} />
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                {m.cancel()}
              </Button>
              <Button
                type="submit"
                form="new-user"
                variant="primary"
                isDisabled={busy}
              >
                {busy ? m.user_dialog_adding() : m.user_dialog_add()}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

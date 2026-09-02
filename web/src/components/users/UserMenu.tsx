import {
  Button,
  Description,
  Dropdown,
  Form,
  Input,
  Label,
  Modal,
  Separator,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { UserAccount, UserRole } from "../../auth/schema";
import {
  changeUserRole,
  reinstateUser,
  removeUser,
  resetUserPassword,
  signOutUserEverywhere,
  suspendUser,
} from "../../functions/users";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { DeleteDialog } from "../DeleteDialog";
import { MoreIcon } from "../icons";
import { PasswordField } from "./PasswordField";
import { RoleSelect } from "./RoleSelect";

type Action = "role" | "reset-password" | "suspend" | "delete";

/** Administrative actions for another account in the directory. */
export function UserMenu({ account }: { account: UserAccount }) {
  const router = useRouter();
  const { run } = useAsyncAction();
  const [open, setOpen] = useState<Action | null>(null);

  const act = (work: () => Promise<unknown>, failure: string, done: string) =>
    void run(work, failure).then(async (result) => {
      if (!result.ok) return;
      toast.success(done);
      await router.invalidate();
    });

  return (
    <>
      <Dropdown>
        <Button
          variant="ghost"
          isIconOnly
          size="sm"
          aria-label={`Actions for ${account.name}`}
        >
          <MoreIcon />
        </Button>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label={`Actions for ${account.name}`}
            onAction={(key) => {
              const action = String(key);
              switch (action) {
                case "reinstate":
                  act(
                    () => reinstateUser({ data: { user: account.id } }),
                    "User not reinstated",
                    `${account.name} reinstated`,
                  );
                  return;
                case "revoke":
                  act(
                    () => signOutUserEverywhere({ data: { user: account.id } }),
                    "Sessions not revoked",
                    `${account.name} signed out everywhere`,
                  );
                  return;
                default:
                  setOpen(action as Action);
              }
            }}
          >
            <Dropdown.Item id="reset-password" textValue="Reset password">
              <Label>Reset password…</Label>
            </Dropdown.Item>
            <Dropdown.Item id="role" textValue="Change role">
              <Label>Change role…</Label>
            </Dropdown.Item>
            <Dropdown.Item id="revoke" textValue="Sign out everywhere">
              <Label>Sign out everywhere</Label>
            </Dropdown.Item>
            {account.banned ? (
              <Dropdown.Item id="reinstate" textValue="Reinstate">
                <Label>Reinstate</Label>
              </Dropdown.Item>
            ) : (
              <Dropdown.Item id="suspend" textValue="Suspend">
                <Label>Suspend…</Label>
              </Dropdown.Item>
            )}
            <Separator orientation="horizontal" />
            <Dropdown.Item id="delete" textValue="Delete user" variant="danger">
              <Label>Delete user…</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <ChangeRoleDialog
        key={open === "role" ? "open" : "closed"}
        account={account}
        isOpen={open === "role"}
        onClose={() => setOpen(null)}
      />
      <ResetPasswordDialog
        account={account}
        isOpen={open === "reset-password"}
        onClose={() => setOpen(null)}
      />
      <SuspendDialog
        account={account}
        isOpen={open === "suspend"}
        onClose={() => setOpen(null)}
      />
      <DeleteDialog
        isOpen={open === "delete"}
        onOpenChange={(next) => setOpen(next ? "delete" : null)}
        title={`Delete ${account.name}?`}
        confirmLabel="Delete user"
        onConfirm={async () => {
          await removeUser({ data: { user: account.id } });
          toast.success(`${account.name} deleted`);
          await router.invalidate();
        }}
      >
        Their account and sessions are removed. Experiment records and reviews
        are not affected.
      </DeleteDialog>
    </>
  );
}

function ChangeRoleDialog({
  account,
  isOpen,
  onClose,
}: {
  account: UserAccount;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [role, setRole] = useState<UserRole>(account.role);

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Change role</Modal.Heading>
              <Description>
                Administrators maintain accounts. The change applies to{" "}
                {account.name}'s next request.
              </Description>
            </Modal.Header>
            <Modal.Body>
              <Form
                id="change-role"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    () => changeUserRole({ data: { user: account.id, role } }),
                    "Role not changed",
                  ).then(async (result) => {
                    if (!result.ok) return;
                    onClose();
                    await router.invalidate();
                  });
                }}
              >
                <RoleSelect value={role} onChange={setRole} isDisabled={busy} />
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="change-role"
                variant="primary"
                isDisabled={busy || role === account.role}
              >
                {busy ? "Saving…" : "Save"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function ResetPasswordDialog({
  account,
  isOpen,
  onClose,
}: {
  account: UserAccount;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { busy, run } = useAsyncAction();

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Reset password for {account.name}</Modal.Heading>
              <Description>
                Their existing sessions stay signed in; use “Sign out
                everywhere” to end them.
              </Description>
            </Modal.Header>
            <Modal.Body key={isOpen ? "open" : "closed"}>
              <Form
                id="change-password"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(
                    () =>
                      resetUserPassword({
                        data: {
                          user: account.id,
                          password: String(form.get("password") ?? ""),
                        },
                      }),
                    "Password not changed",
                  ).then((result) => {
                    if (!result.ok) return;
                    toast.success("Password changed");
                    onClose();
                  });
                }}
              >
                <PasswordField label="New password" isDisabled={busy} />
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="change-password"
                variant="primary"
                isDisabled={busy}
              >
                {busy ? "Saving…" : "Save"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function SuspendDialog({
  account,
  isOpen,
  onClose,
}: {
  account: UserAccount;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Suspend {account.name}?</Modal.Heading>
              <Description>
                They are signed out everywhere and cannot sign in until
                reinstated. The account and its records are kept.
              </Description>
            </Modal.Header>
            <Modal.Body key={isOpen ? "open" : "closed"}>
              <Form
                id="suspend-user"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(
                    () =>
                      suspendUser({
                        data: {
                          user: account.id,
                          reason: String(form.get("reason") ?? ""),
                        },
                      }),
                    "User not suspended",
                  ).then(async (result) => {
                    if (!result.ok) return;
                    toast.success(`${account.name} suspended`);
                    onClose();
                    await router.invalidate();
                  });
                }}
              >
                <TextField
                  variant="secondary"
                  fullWidth
                  isDisabled={busy}
                  name="reason"
                >
                  <Label>Reason</Label>
                  <Input className="w-full" placeholder="Left the lab" />
                </TextField>
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="suspend-user"
                variant="danger"
                isDisabled={busy}
              >
                {busy ? "Suspending…" : "Suspend"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

import {
  Button,
  Description,
  Dropdown,
  Form,
  Label,
  Modal,
  Separator,
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
import { m } from "../../paraglide/messages";
import { DestructiveActionDialog } from "../DestructiveActionDialog";
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
          aria-label={m.user_menu_label({ name: account.name })}
        >
          <MoreIcon />
        </Button>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label={m.user_menu_label({ name: account.name })}
            onAction={(key) => {
              const action = String(key);
              switch (action) {
                case "reinstate":
                  act(
                    () => reinstateUser({ data: { user: account.id } }),
                    m.user_not_reinstated(),
                    m.user_reinstated({ name: account.name }),
                  );
                  return;
                case "revoke":
                  act(
                    () => signOutUserEverywhere({ data: { user: account.id } }),
                    m.user_sessions_not_revoked(),
                    m.user_signed_out_everywhere({ name: account.name }),
                  );
                  return;
                default:
                  setOpen(action as Action);
              }
            }}
          >
            <Dropdown.Item
              id="reset-password"
              textValue={m.user_menu_reset_password()}
            >
              <Label>{m.user_menu_reset_password_item()}</Label>
            </Dropdown.Item>
            <Dropdown.Item id="role" textValue={m.user_menu_change_role()}>
              <Label>{m.user_menu_change_role_item()}</Label>
            </Dropdown.Item>
            <Dropdown.Item
              id="revoke"
              textValue={m.user_menu_sign_out_everywhere()}
            >
              <Label>{m.user_menu_sign_out_everywhere()}</Label>
            </Dropdown.Item>
            {account.banned ? (
              <Dropdown.Item id="reinstate" textValue={m.user_menu_reinstate()}>
                <Label>{m.user_menu_reinstate()}</Label>
              </Dropdown.Item>
            ) : (
              <Dropdown.Item id="suspend" textValue={m.user_menu_suspend()}>
                <Label>{m.user_menu_suspend_item()}</Label>
              </Dropdown.Item>
            )}
            <Separator orientation="horizontal" />
            <Dropdown.Item
              id="delete"
              textValue={m.user_menu_delete()}
              variant="danger"
            >
              <Label>{m.user_menu_delete_item()}</Label>
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
      <DestructiveActionDialog
        isOpen={open === "suspend"}
        onOpenChange={(next) => setOpen(next ? "suspend" : null)}
        title={m.user_suspend_title({ name: account.name })}
        confirmLabel={m.user_suspend_confirm()}
        onConfirm={async () => {
          await suspendUser({ data: { user: account.id } });
          toast.success(m.user_suspended({ name: account.name }));
          await router.invalidate();
        }}
      >
        {m.user_suspend_body()}
      </DestructiveActionDialog>
      <DestructiveActionDialog
        isOpen={open === "delete"}
        onOpenChange={(next) => setOpen(next ? "delete" : null)}
        title={m.user_delete_title({ name: account.name })}
        confirmLabel={m.user_delete_confirm()}
        onConfirm={async () => {
          await removeUser({ data: { user: account.id } });
          toast.success(m.user_deleted({ name: account.name }));
          await router.invalidate();
        }}
      >
        {m.user_delete_body()}
      </DestructiveActionDialog>
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
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>{m.user_role_dialog_title()}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
                id="change-role"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    () => changeUserRole({ data: { user: account.id, role } }),
                    m.user_role_not_changed(),
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
                {m.cancel()}
              </Button>
              <Button
                type="submit"
                form="change-role"
                variant="primary"
                isDisabled={busy || role === account.role}
              >
                {busy ? m.user_dialog_saving() : m.user_dialog_save()}
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
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>
                {m.user_reset_password_title({ name: account.name })}
              </Modal.Heading>
              <Description>{m.user_reset_password_description()}</Description>
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
                    m.user_reset_password_not_changed(),
                  ).then((result) => {
                    if (!result.ok) return;
                    toast.success(m.user_reset_password_changed());
                    onClose();
                  });
                }}
              >
                <PasswordField
                  label={m.user_reset_password_new_label()}
                  isDisabled={busy}
                  variant="secondary"
                />
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                {m.cancel()}
              </Button>
              <Button
                type="submit"
                form="change-password"
                variant="primary"
                isDisabled={busy}
              >
                {busy ? m.user_dialog_saving() : m.user_dialog_save()}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

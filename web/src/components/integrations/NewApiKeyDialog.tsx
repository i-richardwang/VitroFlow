import {
  Button,
  Checkbox,
  CheckboxGroup,
  Description,
  Form,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextField,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  API_SCOPE_LABELS,
  API_SCOPES,
  MAX_API_KEY_DAYS,
  type ApiScope,
  type IssuedApiKey,
} from "../../auth/integrations";
import { addApiKey } from "../../functions/integrations";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import { CopyableCode } from "./CopyableCode";

const EXPIRY_OPTIONS = [
  { id: "30", label: m.api_key_expiry_30_days, days: 30 },
  { id: "90", label: m.api_key_expiry_90_days, days: 90 },
  {
    id: String(MAX_API_KEY_DAYS),
    label: m.api_key_expiry_1_year,
    days: MAX_API_KEY_DAYS,
  },
  { id: "never", label: m.api_key_expiry_never, days: null },
] as const;

export function NewApiKeyDialog({
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

/** Collects the key's details, then shows the secret the one time it exists. */
function Editor({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [scopes, setScopes] = useState<ApiScope[]>(["agent"]);
  const [expiry, setExpiry] = useState<string>(EXPIRY_OPTIONS[0].id);
  const [issued, setIssued] = useState<IssuedApiKey | null>(null);

  const close = () => {
    onClose();
    if (issued) void router.invalidate();
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && close()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={m.close()} />
            {issued ? (
              <>
                <Modal.Header>
                  <Modal.Heading>{issued.name}</Modal.Heading>
                  <Description>{m.api_key_dialog_shown_once()}</Description>
                </Modal.Header>
                <Modal.Body>
                  <CopyableCode
                    value={issued.secret}
                    label={m.api_key_dialog_secret_label()}
                    variant="secondary"
                  />
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="primary" onPress={close}>
                    {m.api_key_dialog_done()}
                  </Button>
                </Modal.Footer>
              </>
            ) : (
              <>
                <Modal.Header>
                  <Modal.Heading>{m.api_key_dialog_title()}</Modal.Heading>
                </Modal.Header>
                <Modal.Body>
                  <Form
                    id="new-api-key"
                    className="flex w-full min-w-0 flex-col gap-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      const expiresInDays =
                        EXPIRY_OPTIONS.find((option) => option.id === expiry)
                          ?.days ?? null;
                      void run(
                        () =>
                          addApiKey({
                            data: {
                              name: String(form.get("name") ?? ""),
                              scopes,
                              expiresInDays,
                            },
                          }),
                        m.api_key_not_created(),
                      ).then((result) => {
                        if (result.ok) setIssued(result.value);
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
                      <Label>{m.api_key_dialog_name_label()}</Label>
                      <Input
                        className="w-full"
                        autoComplete="off"
                        placeholder={m.api_key_dialog_name_placeholder()}
                      />
                    </TextField>
                    <CheckboxGroup
                      isRequired
                      isDisabled={busy}
                      value={scopes}
                      onChange={(next) => setScopes(next as ApiScope[])}
                    >
                      <Label>{m.api_key_dialog_scopes_label()}</Label>
                      {API_SCOPES.map((scope) => (
                        <Checkbox key={scope} value={scope}>
                          <Checkbox.Content>
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                            {API_SCOPE_LABELS[scope]()}
                          </Checkbox.Content>
                        </Checkbox>
                      ))}
                    </CheckboxGroup>
                    <Select
                      variant="secondary"
                      fullWidth
                      isDisabled={busy}
                      selectedKey={expiry}
                      onSelectionChange={(key) => setExpiry(String(key))}
                    >
                      <Label>{m.api_key_dialog_expires_label()}</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {EXPIRY_OPTIONS.map((option) => (
                            <ListBox.Item
                              key={option.id}
                              id={option.id}
                              textValue={option.label()}
                            >
                              {option.label()}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </Form>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="tertiary" isDisabled={busy} onPress={close}>
                    {m.cancel()}
                  </Button>
                  <Button
                    type="submit"
                    form="new-api-key"
                    variant="primary"
                    isDisabled={busy || scopes.length === 0}
                  >
                    {busy
                      ? m.api_key_dialog_creating()
                      : m.api_key_dialog_create()}
                  </Button>
                </Modal.Footer>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

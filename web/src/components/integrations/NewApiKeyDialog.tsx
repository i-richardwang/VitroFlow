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
import { CopyableCode } from "./CopyableCode";

const EXPIRY_OPTIONS = [
  { id: "30", label: "30 days", days: 30 },
  { id: "90", label: "90 days", days: 90 },
  { id: String(MAX_API_KEY_DAYS), label: "1 year", days: MAX_API_KEY_DAYS },
  { id: "never", label: "Never", days: null },
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
            <Modal.CloseTrigger />
            {issued ? (
              <>
                <Modal.Header>
                  <Modal.Heading>{issued.name}</Modal.Heading>
                  <Description>
                    Copy the key now. It is shown only once; a lost key is
                    revoked and replaced.
                  </Description>
                </Modal.Header>
                <Modal.Body>
                  <CopyableCode value={issued.secret} label="API key" />
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="primary" onPress={close}>
                    Done
                  </Button>
                </Modal.Footer>
              </>
            ) : (
              <>
                <Modal.Header>
                  <Modal.Heading>New API key</Modal.Heading>
                  <Description>
                    The key acts as you on the surfaces it is scoped to.
                  </Description>
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
                        "API key not created",
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
                      <Label>Name</Label>
                      <Input
                        className="w-full"
                        autoComplete="off"
                        placeholder="Claude on the lab laptop"
                      />
                    </TextField>
                    <CheckboxGroup
                      isRequired
                      isDisabled={busy}
                      value={scopes}
                      onChange={(next) => setScopes(next as ApiScope[])}
                    >
                      <Label>Scopes</Label>
                      {API_SCOPES.map((scope) => (
                        <Checkbox key={scope} value={scope}>
                          <Checkbox.Content>
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                            {API_SCOPE_LABELS[scope].label}
                          </Checkbox.Content>
                          <Description>
                            {API_SCOPE_LABELS[scope].description}
                          </Description>
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
                      <Label>Expires</Label>
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
                              textValue={option.label}
                            >
                              {option.label}
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
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    form="new-api-key"
                    variant="primary"
                    isDisabled={busy || scopes.length === 0}
                  >
                    {busy ? "Creating…" : "Create"}
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

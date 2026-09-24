import { Description, Label, Switch } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";

import { changeInteractiveAnnotation } from "../../functions/integrations";
import { m } from "../../paraglide/messages";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";

/** An administrator decides whether connected agents may annotate images. */
export function InteractiveAnnotationSwitch({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();

  return (
    <Switch
      isSelected={enabled}
      isDisabled={busy}
      onChange={(next) =>
        void run(
          () => changeInteractiveAnnotation({ data: { enabled: next } }),
          m.interactive_annotation_not_changed(),
        ).then(async (result) => {
          if (result.ok) await router.invalidate();
        })
      }
    >
      <Switch.Content className="flex w-full items-center justify-between gap-6">
        <span className="flex flex-col gap-0.5">
          <Label>{m.interactive_annotation()}</Label>
          <Description>{m.interactive_annotation_description()}</Description>
        </span>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}

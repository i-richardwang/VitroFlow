import { Button, Dropdown, Tooltip } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";

import type { ExperimentDish } from "../../experiments/contracts";
import type { Treatment } from "../../experiments/schema";
import { placeDishes } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { TreatmentChoices } from "./TreatmentChoices";
import { TreatmentDot } from "./TreatmentDot";

export function DishTreatmentMenu({
  experiment,
  dish,
  treatments,
}: {
  experiment: string;
  dish: ExperimentDish;
  treatments: Treatment[];
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const current =
    treatments.find((treatment) => treatment.id === dish.treatment) ?? null;
  const name = current?.name ?? "Unassigned";

  return (
    <Dropdown>
      <Tooltip delay={0}>
        <Button
          variant="ghost"
          isIconOnly
          isDisabled={busy}
          aria-label={`Treatment of dish ${dish.label}`}
        >
          <TreatmentDot position={current?.position ?? null} />
        </Button>
        <Tooltip.Content>{name}</Tooltip.Content>
      </Tooltip>
      <TreatmentChoices
        label={`Treatment of dish ${dish.label}`}
        treatments={treatments}
        onPick={(treatment) => {
          if (treatment === dish.treatment) return;
          void run(
            () =>
              placeDishes({
                data: { experiment, dishes: [dish.label], treatment },
              }),
            "Dish not assigned",
          ).then(async (result) => {
            if (result.ok) await router.invalidate();
          });
        }}
      />
    </Dropdown>
  );
}

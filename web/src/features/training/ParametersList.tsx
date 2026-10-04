import type { ReactNode } from "react";

import type { TrainingParameters } from "../../domain/training/parameters";
import { m } from "../../paraglide/messages";
import { Descriptions, DescriptionsItem } from "../../ui/kit/Descriptions";
import { Skeleton } from "../../ui/kit/Skeleton";
import { formatNumber } from "../../ui/numbers";
import { PARAMETER_GROUPS, PARAMETER_LABELS } from "./parameter-fields";

/** The recipe's parameters by group, flowing into two columns on wider screens. */
export function ParametersList({
  parameters,
}: {
  parameters: TrainingParameters;
}) {
  return <ParameterGroups value={(key) => formatParameter(parameters[key])} />;
}

/** `ParametersList` while the run loads: the labels, with a bone for each value. */
export function ParametersListSkeleton() {
  return (
    <div aria-hidden>
      <ParameterGroups value={() => <Skeleton.Inline width="4em" />} />
    </div>
  );
}

function ParameterGroups({
  value,
}: {
  value: (key: keyof TrainingParameters) => ReactNode;
}) {
  return (
    <div className="gap-x-12 mobile:columns-2">
      {PARAMETER_GROUPS.map((group) => (
        <section
          key={group.key}
          className="mb-5 flex break-inside-avoid flex-col gap-1 last:mb-0"
        >
          <h4 className="text-xs font-medium text-fg-secondary">
            {group.title()}
          </h4>
          <Descriptions justified>
            {group.parameters.map((key) => (
              <DescriptionsItem key={key} label={PARAMETER_LABELS[key]()}>
                {value(key)}
              </DescriptionsItem>
            ))}
          </Descriptions>
        </section>
      ))}
    </div>
  );
}

function formatParameter(value: number | string | boolean): string {
  if (typeof value === "boolean")
    return value ? m.parameter_on() : m.parameter_off();
  return typeof value === "number" ? formatNumber(value) : value;
}

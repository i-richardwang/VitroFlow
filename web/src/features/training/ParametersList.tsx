import type { ReactNode } from "react";

import type { TrainingParameters } from "../../domain/training/parameters";
import { m } from "../../paraglide/messages";
import { Descriptions, DescriptionsItem } from "../../ui/kit/Descriptions";
import { Skeleton } from "../../ui/kit/Skeleton";
import { formatNumber } from "../../ui/numbers";
import { PARAMETER_LABELS } from "./parameter-fields";

const KEYS = Object.keys(PARAMETER_LABELS) as (keyof TrainingParameters)[];
const HALF = Math.ceil(KEYS.length / 2);

/** The recipe's parameters in two label–value columns that stack on narrow screens. */
export function ParametersList({
  parameters,
}: {
  parameters: TrainingParameters;
}) {
  return (
    <ParameterColumns
      value={(key) => (
        <span className="font-mono">{formatParameter(parameters[key])}</span>
      )}
    />
  );
}

/** `ParametersList` while the run loads: the labels, with a bone for each value. */
export function ParametersListSkeleton() {
  return (
    <div aria-hidden>
      <ParameterColumns
        value={() => (
          <Skeleton width="4em" className="inline-block align-middle" />
        )}
      />
    </div>
  );
}

function ParameterColumns({
  value,
}: {
  value: (key: keyof TrainingParameters) => ReactNode;
}) {
  return (
    <div className="grid items-start gap-x-12 mobile:grid-cols-2">
      {[KEYS.slice(0, HALF), KEYS.slice(HALF)].map((keys) => (
        <Descriptions key={keys[0]} aligned>
          {keys.map((key) => (
            <DescriptionsItem key={key} label={PARAMETER_LABELS[key]()}>
              {value(key)}
            </DescriptionsItem>
          ))}
        </Descriptions>
      ))}
    </div>
  );
}

function formatParameter(value: number | string | boolean): string {
  if (typeof value === "boolean")
    return value ? m.parameter_on() : m.parameter_off();
  return typeof value === "number" ? formatNumber(value) : value;
}

import {
  PARAMETER_LABELS,
  type TrainingParameters,
} from "../../training/parameters";

export function ParametersList({
  parameters,
  columns = 1,
}: {
  parameters: TrainingParameters;
  columns?: 1 | 2;
}) {
  return (
    <dl
      className={[
        "grid gap-x-6 gap-y-1.5 text-sm",
        columns === 2
          ? "grid-cols-[max-content_1fr] sm:grid-cols-[max-content_1fr_max-content_1fr]"
          : "grid-cols-[max-content_1fr]",
      ].join(" ")}
    >
      {(Object.keys(PARAMETER_LABELS) as (keyof TrainingParameters)[]).map(
        (key) => (
          <Parameter
            key={key}
            label={PARAMETER_LABELS[key]()}
            value={parameters[key]}
          />
        ),
      )}
    </dl>
  );
}

function Parameter({
  label,
  value,
}: {
  label: string;
  value: number | string | boolean;
}) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono tabular-nums">{String(value)}</dd>
    </>
  );
}

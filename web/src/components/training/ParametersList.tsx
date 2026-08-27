import type { TrainingParameters } from "../../training/parameters";

const LABELS: Record<keyof TrainingParameters, string> = {
  epochs: "Epochs",
  patience: "Patience",
  batch: "Batch",
  imgsz: "Image size",
  optimizer: "Optimizer",
  lr0: "Learning rate",
  warmup_epochs: "Warmup epochs",
  mosaic: "Mosaic",
  mixup: "Mixup",
  copy_paste: "Copy-paste",
  max_det: "Max detections",
  seed: "Seed",
  deterministic: "Deterministic",
};

/** Every Ultralytics argument a run fixes, in recipe order. */
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
      {(Object.keys(LABELS) as (keyof TrainingParameters)[]).map((key) => (
        <Parameter key={key} label={LABELS[key]} value={parameters[key]} />
      ))}
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

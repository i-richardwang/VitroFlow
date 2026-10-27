import type { TrainingWorkerOption } from "../../domain/training/read-model";
import { m } from "../../paraglide/messages";
import { Form } from "../../ui/kit/Form";
import { Select } from "../../ui/kit/Select";

export function TrainingWorkerSelect({
  workers,
  value,
  onChange,
  disabled,
}: {
  workers: TrainingWorkerOption[];
  value: string | null;
  onChange: (workerId: string | null) => void;
  disabled: boolean;
}) {
  return (
    <Form.Field label={m.training_worker()}>
      <Select
        value={value ?? ""}
        disabled={disabled}
        onChange={(id) => onChange(id || null)}
        options={[
          { value: "", label: m.training_worker_auto() },
          ...workers.map((worker) => ({
            value: worker.workerId,
            label: worker.online
              ? worker.workerId
              : m.training_worker_offline({ worker: worker.workerId }),
          })),
        ]}
      />
    </Form.Field>
  );
}

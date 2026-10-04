import { CopyButton } from "./kit/CopyButton";
import { Form } from "./kit/Form";
import { Input } from "./kit/Input";
import { Skeleton } from "./kit/Skeleton";

/** A read-only value with a copy button, such as an endpoint or a key shown once. */
export function CopyableCode({
  value,
  label,
  description,
}: {
  value: string;
  label: string;
  description?: string;
}) {
  return (
    <Form.Field label={label} desc={description}>
      <Input
        readOnly
        value={value}
        className="font-mono"
        suffix={<CopyButton content={value} />}
      />
    </Form.Field>
  );
}

/** `CopyableCode` while its value loads: the label, and a bone in the empty field. */
export function CopyableCodeSkeleton({ label }: { label: string }) {
  return (
    <Form.Field label={label} aria-hidden>
      <Input
        readOnly
        tabIndex={-1}
        prefix={<Skeleton width="16em" className="inline-block" />}
      />
    </Form.Field>
  );
}

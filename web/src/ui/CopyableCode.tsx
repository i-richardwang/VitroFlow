import { Snippet } from "./kit/Snippet";

/** A named read-only value with a copy button, such as an endpoint or a key shown once. */
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
    <div className="flex flex-col gap-2">
      <div className="font-medium">{label}</div>
      <Snippet>{value}</Snippet>
      {description ? (
        <div className="text-xs text-fg-secondary">{description}</div>
      ) : null}
    </div>
  );
}

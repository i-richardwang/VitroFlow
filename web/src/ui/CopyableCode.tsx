import { Snippet } from "./kit/Snippet";
import { Text } from "./kit/Text";

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
      <Text weight="medium">{label}</Text>
      <Snippet>{value}</Snippet>
      {description ? (
        <Text size="xs" type="tertiary">
          {description}
        </Text>
      ) : null}
    </div>
  );
}

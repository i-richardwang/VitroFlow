import { Button, Tooltip } from "@heroui/react";
import { useState } from "react";

import { CopyIcon } from "../icons";

/** A value shown verbatim with a button that copies it. */
export function CopyableCode({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-secondary px-3 py-2">
      <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-xs">
        <code>{value}</code>
      </pre>
      <Tooltip delay={0}>
        <Tooltip.Trigger>
          <Button
            variant="ghost"
            isIconOnly
            size="sm"
            aria-label={`Copy ${label}`}
            onPress={() => {
              void navigator.clipboard.writeText(value).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            <CopyIcon />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content>{copied ? "Copied" : `Copy ${label}`}</Tooltip.Content>
      </Tooltip>
    </div>
  );
}

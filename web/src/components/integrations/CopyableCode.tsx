import { Button, InputGroup, Label, TextField } from "@heroui/react";
import { useEffect, useRef, useState } from "react";

import { Hint } from "../Hint";
import { CheckIcon, CopyIcon } from "../icons";

export function CopyableCode({
  value,
  label,
  variant = "primary",
}: {
  value: string;
  label: string;
  variant?: "primary" | "secondary";
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div className="w-full max-w-md">
      <TextField
        isReadOnly
        fullWidth
        variant={variant}
        value={value}
        name={label}
      >
        <Label>{label}</Label>
        <InputGroup fullWidth variant={variant}>
          <InputGroup.Input />
          <InputGroup.Suffix className="pe-0">
            <Hint text={copied ? "Copied" : "Copy"}>
              <Button
                isIconOnly
                aria-label={copied ? "Copied" : "Copy"}
                size="sm"
                variant="ghost"
                onPress={() => {
                  void navigator.clipboard.writeText(value).then(() => {
                    setCopied(true);
                    if (timer.current !== null) {
                      window.clearTimeout(timer.current);
                    }
                    timer.current = window.setTimeout(() => {
                      setCopied(false);
                      timer.current = null;
                    }, 2000);
                  });
                }}
              >
                {copied ? (
                  <CheckIcon className="size-4" />
                ) : (
                  <CopyIcon className="size-4" />
                )}
              </Button>
            </Hint>
          </InputGroup.Suffix>
        </InputGroup>
      </TextField>
    </div>
  );
}

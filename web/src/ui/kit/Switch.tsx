import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { animate, motionValue } from "motion";
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "./cn";
import { springTransition } from "./motionToken";

/*
 * A controlled switch. The thumb stretches while pressed and springs to its
 * place; its offset and width are motion values written straight to the
 * element, so React never rewrites them mid-flight.
 */

export type SwitchSize = "default" | "small";

const THUMB_METRICS: Record<
  SwitchSize,
  {
    checkedX: number;
    pressedCheckedX: number;
    pressedWidth: number;
    width: number;
  }
> = {
  default: { checkedX: 14, pressedCheckedX: 10, pressedWidth: 22, width: 18 },
  small: { checkedX: 12, pressedCheckedX: 8, pressedWidth: 16, width: 12 },
};

const THUMB_SPRING = { damping: 24, stiffness: 360 };

const ROOT_SIZE = {
  default: "ui-switch-root-default",
  small: "ui-switch-root-small",
} as const;

const THUMB_SIZE = {
  default: "ui-switch-thumb-default",
  small: "ui-switch-thumb-small",
} as const;

function SwitchThumb({
  checked,
  pressed,
  size,
}: {
  checked: boolean;
  pressed: boolean;
  size: SwitchSize;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  const metrics = THUMB_METRICS[size];
  const targetX = checked
    ? pressed
      ? metrics.pressedCheckedX
      : metrics.checkedX
    : 0;
  const targetWidth = pressed ? metrics.pressedWidth : metrics.width;

  const [values] = useState(() => ({
    width: motionValue(targetWidth),
    x: motionValue(targetX),
  }));

  const [initialStyle] = useState<CSSProperties>(
    () =>
      ({
        "--ui-switch-x": `${targetX}px`,
        width: targetWidth,
      }) as CSSProperties,
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const unsubscribeX = values.x.on("change", (x) => {
      el.style.setProperty("--ui-switch-x", `${x}px`);
    });
    const unsubscribeWidth = values.width.on("change", (width) => {
      el.style.setProperty("width", `${width}px`);
    });
    return () => {
      unsubscribeX();
      unsubscribeWidth();
    };
  }, [values]);

  useEffect(() => {
    const transition = springTransition(THUMB_SPRING);
    const animations = [
      animate(values.x, targetX, transition),
      animate(values.width, targetWidth, transition),
    ];
    return () => {
      for (const animation of animations) animation.stop();
    };
  }, [values, targetX, targetWidth]);

  return (
    <BaseSwitch.Thumb
      render={
        <span
          className={cn("ui-switch-thumb", THUMB_SIZE[size])}
          ref={ref}
          style={initialStyle}
        />
      }
    />
  );
}

export interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  size?: SwitchSize;
}

export function Switch({
  checked,
  disabled,
  onChange,
  size = "default",
}: SwitchProps) {
  const [pressed, setPressed] = useState(false);
  const press = () => {
    if (!disabled) setPressed(true);
  };
  const release = () => setPressed(false);

  return (
    <BaseSwitch.Root
      nativeButton
      checked={checked}
      disabled={disabled}
      render={
        <button
          className={cn("ui-switch", ROOT_SIZE[size])}
          type="button"
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === " ") press();
          }}
          onKeyUp={(event: KeyboardEvent) => {
            if (event.key === " ") release();
          }}
          onPointerCancel={release}
          onPointerDown={press}
          onPointerLeave={release}
          onPointerUp={release}
        />
      }
      onCheckedChange={(next) => onChange(next)}
    >
      <SwitchThumb checked={checked} pressed={pressed} size={size} />
    </BaseSwitch.Root>
  );
}

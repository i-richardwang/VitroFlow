import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import { defaultPortalContainer, triggerRender } from "./floating";
import { Hotkey } from "./Hotkey";

/*
 * With neither `title` nor `hotkey`, children are returned as is. The trigger
 * is a single element whose props and ref merge into it, with no extra
 * wrapper (see floating.ts). A disabled control takes no pointer events, so
 * it is wrapped in a span that hosts the tooltip and can say why it is
 * disabled. Each tooltip has one trigger.
 */

const OPEN_DELAY = 400;
const CLOSE_DELAY = 100;

/** The side of the trigger the tooltip sits on, centered along it. */
export type TooltipPlacement = "top" | "right" | "bottom";

export interface TooltipProps {
  children: ReactElement;
  /** Written like Hotkey's `keys` (`mod+k`). */
  hotkey?: string;
  placement?: TooltipPlacement;
  title?: ReactNode;
}

export function Tooltip({
  children,
  title,
  hotkey,
  placement = "top",
}: TooltipProps) {
  if (title == null && !hotkey) return children;

  const child = children as ReactElement<Record<string, unknown>>;
  // When the child is itself a popup trigger (aria-haspopup with an id), the tooltip trigger keeps that id.
  const popupTriggerId =
    child.props["aria-haspopup"] !== undefined &&
    typeof child.props.id === "string"
      ? child.props.id
      : undefined;

  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger
        closeDelay={CLOSE_DELAY}
        delay={OPEN_DELAY}
        id={popupTriggerId}
        render={
          child.props.disabled ? (
            <span className="ui-tooltip-disabled-trigger">{children}</span>
          ) : (
            triggerRender(children)
          )
        }
      />
      <BaseTooltip.Portal container={defaultPortalContainer()}>
        <BaseTooltip.Positioner
          className="ui-tooltip-positioner"
          data-placement={placement}
          side={placement}
          sideOffset={6}
        >
          <BaseTooltip.Popup className="ui-tooltip-popup">
            <BaseTooltip.Viewport className="ui-tooltip-viewport">
              {title}
              {hotkey ? <Hotkey compact keys={hotkey} /> : null}
            </BaseTooltip.Viewport>
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

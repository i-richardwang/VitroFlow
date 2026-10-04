import { motion, useTransform } from "motion/react";
import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { m } from "../../paraglide/messages";
import {
  createPanelController,
  type PanelControllerOptions,
} from "./draggablePanelController";
import { foldTransition } from "./motionToken";

/*
 * A panel on the inline-end side of the page, resized by dragging its seam.
 * The seam is a separator: drag to resize, double-click to return to
 * `defaultWidth`, arrow keys to step, Enter or Space to fold. The toggle in
 * the seam folds and unfolds it.
 */

const PAN_THRESHOLD = 3;
const COLLAPSED_SCALE = 0.97;

const BOW = { bulge: 10, curve: 0.44, half: 46, stroke: 1.25 };
const BOW_CX = 15;
const BOW_CY = BOW.half + 8;
const BOW_W = BOW_CX * 2;
const BOW_H = BOW_CY * 2;

/** One half of the bow around a vertical seam; `along` runs down the seam. */
const bowPath = (direction: 1 | -1) => {
  const k = BOW.half * BOW.curve;
  const b = BOW_CX + BOW.bulge * direction;
  const a0 = BOW_CY - BOW.half;
  const a1 = BOW_CY + BOW.half;
  return [
    `M${BOW_CX} ${a0}`,
    `C${BOW_CX} ${a0 + k} ${b} ${BOW_CY - k} ${b} ${BOW_CY}`,
    `C${b} ${BOW_CY + k} ${BOW_CX} ${a1 - k} ${BOW_CX} ${a1}`,
  ].join(" ");
};

const BOW_PATHS = [bowPath(-1), bowPath(1)];

/** Points right, the way a click folds the panel; the stylesheet turns it while folded. */
const CHEVRON_PATH = `M${BOW_CX - 2.4} ${BOW_CY - 4.8} L${BOW_CX + 2.4} ${BOW_CY} L${BOW_CX - 2.4} ${BOW_CY + 4.8}`;

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const useStore = <T,>(
  subscribe: (listener: () => void) => () => void,
  get: () => T,
) => useSyncExternalStore(subscribe, get, get);

export function DraggablePanel({
  "aria-label": ariaLabel,
  children,
  defaultWidth,
  maxWidth,
  minWidth,
}: {
  "aria-label": string;
  children: ReactNode;
  defaultWidth: number;
  maxWidth: number;
  minWidth: number;
}) {
  const contentId = useId();
  const [expand, setExpand] = useState(true);
  const [width, setWidth] = useState(defaultWidth);

  const options: PanelControllerOptions = {
    defaultSize: defaultWidth,
    expand,
    max: maxWidth,
    min: minWidth,
    onExpandChange: setExpand,
    onSizeChange: setWidth,
    size: width,
  };

  const [controller] = useState(() => createPanelController(options));
  const state = useStore(controller.subscribe, () => controller.state);
  // Subscribed, not read: a collapse that changes only the target would otherwise
  // leave the content unclipped and painted outside the zero-width box.
  const target = useStore(controller.subscribe, () => controller.target);
  const elementRef = useRef<HTMLElement>(null);

  useIsomorphicLayoutEffect(() => {
    controller.sync(options);
  });

  useIsomorphicLayoutEffect(() => {
    const node = elementRef.current;
    return node ? controller.attach(node) : undefined;
  }, [controller]);

  const extent = useTransform(controller.motion.size, (value) =>
    Math.max(0, value),
  );
  useEffect(() => () => controller.drag.cancel(), [controller]);

  const pressedRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const draggedRef = useRef(false);
  const clipping = state.dragging || state.folding || target === 0;

  return (
    <aside
      aria-label={ariaLabel}
      className="ui-draggable-panel"
      data-expand={expand}
      data-resizing={state.dragging}
      ref={elementRef}
    >
      <div className="ui-draggable-panel-toggle-root">
        <button
          aria-label={
            expand
              ? m.ui_draggable_panel_collapse()
              : m.ui_draggable_panel_expand()
          }
          className="ui-draggable-panel-toggle"
          type="button"
          onClick={() => setExpand(!expand)}
        >
          <svg
            aria-hidden
            fill="none"
            height={BOW_H}
            viewBox={`0 0 ${BOW_W} ${BOW_H}`}
            width={BOW_W}
          >
            {BOW_PATHS.map((d) => (
              <path
                d={d}
                data-bow=""
                key={d}
                strokeLinecap="round"
                strokeWidth={BOW.stroke}
              />
            ))}
            <path
              className="ui-draggable-panel-chevron"
              d={CHEVRON_PATH}
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.6}
            />
          </svg>
        </button>
      </div>
      <motion.div
        className="ui-draggable-panel-frame"
        inert={!expand}
        style={{ overflow: clipping ? "clip" : "visible", width: extent }}
      >
        <motion.div
          animate={{ scale: expand ? 1 : COLLAPSED_SCALE }}
          className="ui-draggable-panel-content"
          id={contentId}
          transition={foldTransition()}
          style={{ width: controller.motion.content }}
        >
          {children}
        </motion.div>
      </motion.div>
      {expand ? (
        // biome-ignore lint/a11y/useSemanticElements: a focusable window splitter; <hr> is a static rule
        <div
          aria-controls={contentId}
          aria-label={m.ui_draggable_panel_resize({ panel: ariaLabel })}
          aria-orientation="vertical"
          aria-valuemax={maxWidth}
          aria-valuemin={minWidth}
          aria-valuenow={target}
          aria-valuetext={m.ui_draggable_panel_size({ size: target })}
          className="ui-draggable-panel-handle"
          data-resizing={state.dragging || undefined}
          role="separator"
          tabIndex={0}
          onKeyDown={(event) => controller.resizeByKey(event)}
          onDoubleClick={() => {
            if (!draggedRef.current) controller.reset();
          }}
          // Capture can be stolen mid-drag and the pointerup then never arrives; the
          // pointer is wherever the user last dragged it, so commit rather than snap back.
          onLostPointerCapture={() => {
            if (draggingRef.current) controller.drag.end();
            pressedRef.current = null;
            draggingRef.current = false;
          }}
          onPointerCancel={() => {
            controller.drag.cancel();
            pressedRef.current = null;
            draggingRef.current = false;
          }}
          onPointerDown={(event) => {
            draggedRef.current = false;
            pressedRef.current = { x: event.clientX, y: event.clientY };
            // A synthetic pointerdown carries no active pointer, and capturing throws.
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Nothing to capture.
            }
          }}
          onPointerMove={(event) => {
            if (!pressedRef.current) return;
            const offset = event.clientX - pressedRef.current.x;
            const drift = event.clientY - pressedRef.current.y;
            if (!draggingRef.current) {
              if (Math.hypot(offset, drift) < PAN_THRESHOLD) return;
              draggingRef.current = true;
              draggedRef.current = true;
              controller.drag.start();
            }
            controller.drag.move(offset);
          }}
          onPointerUp={() => {
            if (draggingRef.current) controller.drag.end();
            pressedRef.current = null;
            draggingRef.current = false;
          }}
        />
      ) : null}
    </aside>
  );
}

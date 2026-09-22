/** Isolated DOM harness: real workbench, draft and viewport; external UI widgets are inert. */
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { Window } from "happy-dom";
import {
  act,
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";

const browser = new Window({ url: "http://localhost" });
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "MutationObserver",
  "getComputedStyle",
] as const) {
  const value = key === "window" ? browser : browser[key];
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});
Object.defineProperty(browser.HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get: () => 600,
});
Object.defineProperty(browser.HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get: () => 400,
});
let observed = 0;
let disconnected = 0;
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: class {
    observe() {
      observed++;
    }
    disconnect() {
      disconnected++;
    }
  },
});

function Widget({ children }: { children?: ReactNode }) {
  return createElement("div", null, children);
}
const widget = Object.assign(
  Widget,
  Object.fromEntries(
    [
      "Content",
      "Trigger",
      "Value",
      "Indicator",
      "Popover",
      "Item",
      "ItemIndicator",
      "Separator",
      "Backdrop",
      "Container",
      "Dialog",
      "Header",
      "Heading",
      "Footer",
      "Control",
      "Thumb",
      "Label",
      "Track",
      "Fill",
    ].map((name) => [name, Widget]),
  ),
);
function Button({
  children,
  onPress,
  isPending,
  isDisabled,
}: {
  children?: ReactNode;
  onPress?: () => void;
  isPending?: boolean;
  isDisabled?: boolean;
}) {
  return createElement(
    "button",
    { onClick: onPress, disabled: isPending || isDisabled },
    children,
  );
}
const selections = new Map<string, (key: string) => void>();
function SelectionWidget(props: {
  children?: ReactNode;
  selectedKey?: string;
  onSelectionChange?: (key: string) => void;
}) {
  if (props.selectedKey && props.onSelectionChange)
    selections.set(props.selectedKey, props.onSelectionChange);
  return Widget(props);
}
const selectWidget = Object.assign(SelectionWidget, widget);
const DropdownActions = createContext<((key: string) => void) | null>(null);
function DropdownMenu(props: {
  children?: ReactNode;
  onAction?: (key: string) => void;
}) {
  return createElement(
    DropdownActions.Provider,
    { value: props.onAction ?? null },
    props.children,
  );
}
function DropdownItem(props: { id: string; children?: ReactNode }) {
  const onAction = useContext(DropdownActions);
  return createElement(
    "button",
    { onClick: () => onAction?.(props.id), "data-item": props.id },
    props.children,
  );
}
const dropdownWidget = Object.assign(Widget, {
  ...widget,
  Menu: DropdownMenu,
  Item: DropdownItem,
});
mock.module("@heroui/react", () => ({
  Dropdown: dropdownWidget,
  Modal: widget,
  Chip: widget,
  Alert: widget,
  AlertDialog: widget,
  Button,
  ButtonGroup: widget,
  Kbd: widget,
  ListBox: widget,
  Select: selectWidget,
  Label: widget,
  TextField: widget,
  TextArea: widget,
  ProgressBar: widget,
  Separator: widget,
  ToggleButton: widget,
  ToggleButtonGroup: widget,
  Tooltip: widget,
  Card: widget,
  Toolbar: widget,
  Switch: widget,
  SwitchGroup: widget,
  toast: { danger() {}, warning() {}, success() {} },
}));
mock.module("@heroui-pro/react/inline-select", () => ({
  InlineSelect: widget,
}));
mock.module("@heroui-pro/react/segment", () => ({
  Segment: selectWidget,
}));
mock.module("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: async () => {} }),
  useBlocker: () => ({ status: "idle" }),
}));
mock.module("../src/ui/shell/shell", () => ({
  ShellActions: Widget,
  ShellAside: ({ children }: { children?: ReactNode }) =>
    createElement("aside", null, children),
}));
let saved: { data: { base: unknown; instances: unknown } } | undefined;
let resolveAnnotation: ((value: unknown) => void) | undefined;
mock.module("../src/functions/review", () => ({
  getAnnotation: () =>
    new Promise((resolve) => {
      resolveAnnotation = resolve;
    }),
  saveAnnotation: async (request: typeof saved) => {
    saved = request;
    return { status: "saved" };
  },
}));
let startRequests: { executor: unknown; input: unknown }[] = [];
mock.module("../src/functions/annotation-runs", () => ({
  startAnnotationRun: async ({
    data,
  }: {
    data: { executor: unknown; input: unknown };
  }) => {
    startRequests.push(data);
    throw new Error("No online Worker provides the selected agent");
  },
  stopAnnotationRun: async () => {},
}));
const { ImageWorkbench } =
  await import("../src/features/calibration/ImageWorkbench");
const { SEED_DETECTOR } = await import("../src/domain/models/builtins");
const { m } = await import("../src/paraglide/messages");
const imageSize = { digest: "a".repeat(64), width: 1000, height: 800 };
const annotation = {
  schemaVersion: 1 as const,
  image: imageSize,
  instances: [
    {
      id: "box-1",
      class: "seed",
      bbox: { x: 100, y: 100, width: 50, height: 50 },
    },
  ],
};
const proposal = {
  runId: "qa-ai-result",
  executor: { kind: "worker" as const, runtime: "pi" as const },
  createdAt: "2026-09-14T00:00:00Z",
  document: {
    ...annotation,
    instances: [1, 2, 3].map((index) => ({
      ...annotation.instances[0]!,
      id: `ai-${index}`,
      bbox: { x: 100 * index, y: 100, width: 40, height: 40 },
    })),
  },
  issues: [],
  uncertainIds: [],
};
const review = {
  ref: { digest: imageSize.digest, modelId: SEED_DETECTOR.id },
  filename: "seed.avif",
  width: imageSize.width,
  height: imageSize.height,
  detection: null,
  proposal,
  annotation,
  activity: null,
};
const mount = browser.document.createElement("div");
browser.document.body.append(mount);
const root = createRoot(mount as unknown as HTMLElement);
let source: "review" | "proposal" | "detection" | undefined;
const render = async (calibrating: boolean, model = SEED_DETECTOR) => {
  await act(async () => {
    root.render(
      createElement(ImageWorkbench, {
        title: "Seed",
        model,
        review: { ...review, ref: { ...review.ref, modelId: model.id } },
        agents: ["pi"],
        calibrating,
        source,
        onSourceChange(next) {
          source = next;
        },
        onCalibratingChange() {},
      }),
    );
  });
};
const item = (id: string) =>
  Array.from(mount.querySelectorAll("button")).find(
    (button) => button.getAttribute("data-item") === id,
  );
const labeled = (text: string) =>
  Array.from(mount.querySelectorAll("button")).find(
    (button) => button.textContent === text,
  );
await render(false);
const image = mount.querySelector("img")!;
const surface = image.parentElement! as import("happy-dom").HTMLElement;
const frame = surface.parentElement!;
const boxes = () => surface.querySelectorAll("rect[vector-effect]").length;
assert.equal(boxes(), 1, "the reviewer's boxes outrank the agent's");
await act(async () => selections.get("review")!("proposal"));
await render(false);
assert.equal(boxes(), 3, "the page can show the agent's reading instead");
source = undefined;
await render(false);
assert.equal(boxes(), 1);
const initial = surface.style.transform;
await act(async () => {
  frame.dispatchEvent(
    Object.assign(
      new browser.MouseEvent("wheel", {
        clientX: 200,
        clientY: 120,
        bubbles: true,
      }),
      { deltaY: -300 },
    ),
  );
});
const zoomed = surface.style.transform;
assert.notEqual(zoomed, initial, "the wheel must establish a manual view");
frame.setPointerCapture = () => {};
frame.releasePointerCapture = () => {};
await act(async () => {
  frame.dispatchEvent(
    new browser.PointerEvent("pointerdown", {
      pointerId: 1,
      button: 0,
      clientX: 200,
      clientY: 120,
      bubbles: true,
    }),
  );
});
await act(async () => {
  frame.dispatchEvent(
    new browser.PointerEvent("pointermove", {
      pointerId: 1,
      clientX: 140,
      clientY: 80,
      bubbles: true,
    }),
  );
});
await act(async () => {
  frame.dispatchEvent(
    new browser.PointerEvent("pointerup", {
      pointerId: 1,
      clientX: 140,
      clientY: 80,
      bubbles: true,
    }),
  );
});
const manual = surface.style.transform;
assert.notEqual(manual, zoomed, "the pointer must establish a manual pan");
await render(true);
assert.ok(
  mount.querySelector("aside"),
  "loading must retain the inspector layout slot",
);
assert.ok(labeled(m.workbench_save())?.disabled, "loading must pending Save");
assert.equal(labeled(m.workbench_calibrate()), undefined);
assert.strictEqual(mount.querySelector("img"), image);
assert.equal(surface.style.transform, manual);
assert.equal(boxes(), 1);
await act(async () => {
  browser.document.dispatchEvent(
    new browser.KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
  );
});
assert.equal(boxes(), 1, "loading must not attach keyboard handlers");
const latest = {
  ...annotation,
  instances: [
    ...annotation.instances,
    {
      ...annotation.instances[0]!,
      id: "other-reviewer",
      bbox: { x: 300, y: 200, width: 60, height: 60 },
    },
  ],
};
await act(async () => {
  resolveAnnotation?.(latest);
});
assert.equal(boxes(), 2, "calibration must display the fetched annotation");
assert.equal(boxes(), 2, "an available proposal must not replace the draft");
await act(async () => item("pi:refit")!.click());
assert.deepEqual(
  startRequests.map((request) => request.executor),
  [{ kind: "worker", runtime: "pi" }],
  "the request names the agent and leaves admission to the server",
);
assert.deepEqual(
  startRequests[0]?.input,
  latest.instances,
  "refitting sends the draft as the agent's starting point",
);
assert.equal(boxes(), 2, "a server refusal leaves the draft alone");
await act(async () => item("proposal")!.click());
assert.equal(boxes(), 3, "resetting to the proposal replaces the draft");
await act(async () => item("review")!.click());
assert.equal(boxes(), 2, "resetting to the review restores the stored boxes");
await act(async () => item("proposal")!.click());
assert.equal(boxes(), 3);
await act(async () => {
  browser.window.dispatchEvent(
    new browser.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
    }),
  );
});
assert.equal(boxes(), 2, "Undo restores the draft before the AI result");
assert.strictEqual(mount.querySelector("img"), image);
assert.equal(surface.style.transform, manual);

const save = labeled(m.workbench_save());
assert.ok(save);
assert.equal(save.disabled, false);
await act(async () => {
  save.click();
});
assert.deepEqual(saved?.data.base, latest.instances);
assert.deepEqual(
  saved?.data.instances,
  latest.instances,
  "saving must retain the other reviewer's boxes",
);
assert.strictEqual(
  mount.querySelector("img"),
  image,
  "calibration must retain the image DOM node",
);
assert.strictEqual(
  surface.style.transform,
  manual,
  "calibration must preserve scale and pan",
);
assert.equal(observed, 1, "calibration must not remount the viewport");
assert.equal(disconnected, 0);
await render(false);
assert.ok(labeled(m.workbench_calibrate()));
assert.strictEqual(mount.querySelector("img"), image);
assert.equal(
  surface.style.transform,
  manual,
  "leaving calibration must preserve scale and pan",
);
assert.equal(observed, 1);
await render(true);
assert.ok(labeled(m.workbench_save())?.disabled);
await render(false);
await act(async () => {
  resolveAnnotation?.(latest);
});
assert.ok(
  labeled(m.workbench_calibrate()),
  "a cancelled load must not start a session",
);
assert.equal(boxes(), 1);
assert.strictEqual(mount.querySelector("img"), image);
assert.equal(surface.style.transform, manual);
await render(true);
await act(async () => {
  resolveAnnotation?.(latest);
});
assert.equal(boxes(), 2);
const otherModel = {
  ...SEED_DETECTOR,
  id: "another-model",
  name: "Another model",
};
await render(true, otherModel);
assert.ok(
  labeled(m.workbench_save())?.disabled,
  "a different model must load its own baseline",
);
assert.equal(boxes(), 1);
assert.strictEqual(mount.querySelector("img"), image);
assert.equal(surface.style.transform, manual);
await act(async () => {
  resolveAnnotation?.(null);
});
assert.equal(boxes(), 0);
const otherSave = labeled(m.workbench_save());
assert.ok(otherSave);
assert.equal(otherSave.disabled, false);
await act(async () => {
  otherSave.click();
});
assert.equal(saved?.data.base, null);
assert.deepEqual(
  saved?.data.instances,
  [],
  "a first review must not inherit another model's annotation",
);
assert.equal(observed, 1);
await act(async () => root.unmount());
assert.equal(disconnected, 1);
await browser.happyDOM.close();
console.log("Calibration retains one viewport");

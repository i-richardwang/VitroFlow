/** Isolated DOM harness: real workbench, draft and viewport; external UI widgets are inert. */
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement, type ReactNode } from "react";
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
mock.module("@heroui/react", () => ({
  Chip: widget,
  Alert: widget,
  AlertDialog: widget,
  Button,
  ButtonGroup: widget,
  Kbd: widget,
  ListBox: widget,
  Separator: widget,
  ToggleButton: widget,
  ToggleButtonGroup: widget,
  Tooltip: widget,
  Card: widget,
  Toolbar: widget,
  Switch: widget,
  SwitchGroup: widget,
  toast: { danger() {}, warning() {} },
}));
mock.module("@heroui-pro/react/inline-select", () => ({
  InlineSelect: widget,
}));
let editorRenders = 0;
mock.module("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: async () => {} }),
  useBlocker: () => {
    editorRenders++;
    return { status: "idle" };
  },
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
const { ImageWorkbench } =
  await import("../src/features/calibration/ImageWorkbench");
const { SEED_DETECTOR } = await import("../src/domain/models/builtins");
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
const review = {
  ref: { digest: imageSize.digest, modelId: SEED_DETECTOR.id },
  filename: "seed.avif",
  width: imageSize.width,
  height: imageSize.height,
  detection: null,
  annotation,
};
const mount = browser.document.createElement("div");
browser.document.body.append(mount);
const root = createRoot(mount as unknown as HTMLElement);
const render = async (editing: boolean, model = SEED_DETECTOR) => {
  await act(async () => {
    root.render(
      createElement(ImageWorkbench, {
        title: "Seed",
        model,
        review: { ...review, ref: { ...review.ref, modelId: model.id } },
        calibrating: editing,
        onCalibratingChange() {},
      }),
    );
  });
};
await render(false);
const image = mount.querySelector("img")!;
const surface = image.parentElement! as import("happy-dom").HTMLElement;
const frame = surface.parentElement!;
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
// Use the same pointer gestures as the mounted viewport, including pointer capture.
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
assert.equal(editorRenders, 0, "loading must not mount the editing session");
assert.strictEqual(mount.querySelector("img"), image);
assert.equal(surface.style.transform, manual);
await act(async () => {
  browser.document.dispatchEvent(
    new browser.KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
  );
});
assert.equal(editorRenders, 0);
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
assert.ok(editorRenders > 0);
assert.equal(
  surface.querySelectorAll("rect[vector-effect]").length,
  2,
  "editing must display the fetched annotation",
);
const { m } = await import("../src/paraglide/messages");
const save = Array.from(mount.querySelectorAll("button")).find(
  (button) => button.textContent === m.workbench_save(),
);
assert.ok(save);
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
  "editing must retain the image DOM node",
);
assert.strictEqual(
  surface.style.transform,
  manual,
  "editing must preserve scale and pan",
);
assert.equal(observed, 1, "editing must not remount the viewport");
assert.equal(disconnected, 0);
await render(false);
assert.strictEqual(mount.querySelector("img"), image);
assert.equal(
  surface.style.transform,
  manual,
  "leaving editing must preserve scale and pan",
);
assert.equal(observed, 1);
const previousRenders = editorRenders;
await render(true);
assert.equal(editorRenders, previousRenders);
await render(false);
await act(async () => {
  resolveAnnotation?.(latest);
});
assert.equal(
  editorRenders,
  previousRenders,
  "a cancelled load must not start an editor",
);
assert.strictEqual(mount.querySelector("img"), image);
assert.equal(surface.style.transform, manual);
await render(true);
await act(async () => {
  resolveAnnotation?.(latest);
});
const beforeModelChange = editorRenders;
const otherModel = {
  ...SEED_DETECTOR,
  id: "another-model",
  name: "Another model",
};
await render(true, otherModel);
assert.equal(
  editorRenders,
  beforeModelChange,
  "a different model must load its own baseline",
);
assert.strictEqual(mount.querySelector("img"), image);
assert.equal(surface.style.transform, manual);
await act(async () => {
  resolveAnnotation?.(null);
});
assert.ok(editorRenders > beforeModelChange);
const otherSave = Array.from(mount.querySelectorAll("button")).find(
  (button) => button.textContent === m.workbench_save(),
);
assert.ok(otherSave);
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
console.log(
  "Calibration retains one viewport across viewing/editing transitions",
);

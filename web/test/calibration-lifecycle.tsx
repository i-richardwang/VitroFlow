/** Isolated DOM harness: real workbench, draft, viewport, controls and menus. */
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { act, createElement, type ReactNode } from "react";

import {
  body,
  browser,
  button,
  mount,
  press,
  render as renderNode,
  unmount,
  waitFor,
} from "./dom";

Object.defineProperty(browser.HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get: () => 600,
});
Object.defineProperty(browser.HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get: () => 400,
});
/** Elements each resize observer watched, and those whose observer let go. */
const observations: unknown[] = [];
const disconnections: unknown[] = [];
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: class {
    targets: unknown[] = [];
    observe(target: unknown) {
      this.targets.push(target);
      observations.push(target);
    }
    unobserve() {}
    disconnect() {
      disconnections.push(...this.targets);
    }
  },
});

function Passthrough({ children }: { children?: ReactNode }) {
  return createElement("div", null, children);
}
mock.module("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: async () => {} }),
  useBlocker: () => ({ status: "idle" }),
}));
mock.module("../src/ui/shell/shell", () => ({
  ShellActions: Passthrough,
  ShellAside: ({ children }: { children?: ReactNode }) =>
    createElement("aside", null, children),
}));
let saved: { data: { base: unknown; instances: unknown } } | undefined;
let saves = 0;
/** What the next save answers once released. */
let saveStatus: "saved" | "conflict" = "saved";
let releaseSave: (() => void) | undefined;
let resolveAnnotation: ((value: unknown) => void) | undefined;
mock.module("../src/functions/review", () => ({
  getAnnotation: () =>
    new Promise((resolve) => {
      resolveAnnotation = resolve;
    }),
  saveAnnotation: (request: typeof saved) => {
    saves++;
    saved = request;
    return new Promise((resolve) => {
      releaseSave = () => resolve({ status: saveStatus });
    });
  },
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
      class: "ungerminated",
      bbox: { x: 100, y: 100, width: 50, height: 50 },
    },
  ],
};
const proposal = {
  createdAt: "2026-09-14T00:00:00Z",
  document: {
    ...annotation,
    instances: [1, 2, 3].map((index) => ({
      ...annotation.instances[0]!,
      id: `ai-${index}`,
      bbox: { x: 100 * index, y: 100, width: 40, height: 40 },
    })),
  },
  issues: [
    { bbox: { x: 600, y: 500, width: 30, height: 30 }, reason: "Faint streak" },
  ],
  uncertainIds: ["ai-2"],
};
const review = {
  ref: { digest: imageSize.digest, modelId: SEED_DETECTOR.id },
  filename: "seed.avif",
  width: imageSize.width,
  height: imageSize.height,
  detection: null,
  proposal,
  annotation,
  progress: null,
};
let source: "review" | "proposal" | "detection" | undefined;
const render = (calibrating: boolean, model = SEED_DETECTOR) =>
  renderNode(
    createElement(ImageWorkbench, {
      title: "Seed",
      model,
      review: { ...review, ref: { ...review.ref, modelId: model.id } },
      calibrating,
      source,
      onSourceChange(next) {
        source = next;
      },
      onCalibratingChange() {},
    }),
  );
/** A busy button stays focusable and shows it is busy. */
const pending = (
  element: { getAttribute(name: string): string | null } | undefined,
) => element?.getAttribute("aria-busy") === "true";
/** Opens the draft's reset menu and chooses the reading to start again from. */
const resetTo = async (source: string) => {
  await press(
    body.querySelector(`button[aria-label="${m.calibration_restart()}"]`),
  );
  await press(
    await waitFor(
      () =>
        Array.from(body.querySelectorAll('[role="menuitem"]')).find(
          (entry) =>
            entry.textContent === m.calibration_restart_from({ source }),
        ),
      "the reset menu offers the reading",
    ),
  );
};
/** Clicks a busy Save button and tells whether no further save started. */
const refuses = async (element: { click(): void } | undefined) => {
  const before = saves;
  await act(async () => element!.click());
  return saves === before;
};
await render(false);
const image = mount.querySelector("img")!;
const surface = image.parentElement! as import("happy-dom").HTMLElement;
const frame = surface.parentElement!;
const boxes = () =>
  surface.querySelectorAll("rect[vector-effect]:not([stroke-dasharray])")
    .length;
const checks = () => surface.querySelectorAll("rect[stroke-dasharray]").length;
/** How often the viewport's frame was observed, and released, for resizing. */
const observed = () => observations.filter((target) => target === frame).length;
const disconnected = () =>
  disconnections.filter((target) => target === frame).length;
assert.equal(boxes(), 1, "the reviewer's boxes outrank the agent's");
await act(async () => button(m.calibration_source_proposal())!.click());
await render(false);
assert.equal(boxes(), 3, "the page can show the agent's reading instead");
assert.equal(checks(), 2, "the agent's reading outlines what it asks to check");
assert.equal(
  Array.from(surface.querySelectorAll("span")).filter(
    (span) => span.textContent === "?",
  ).length,
  1,
  "a questioned area carries a marker for the agent's reason",
);
source = undefined;
await render(false);
assert.equal(boxes(), 1);
assert.equal(checks(), 0, "the review outranks the agent's questions");
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
/** The view the person last chose, which calibration must hold. */
const held = surface.style.transform;
assert.notEqual(held, zoomed, "the pointer must establish a manual pan");
await render(true);
assert.ok(
  mount.querySelector("aside"),
  "loading must retain the inspector layout slot",
);
assert.ok(pending(button(m.calibration_save())), "loading must pending Save");
assert.equal(button(m.calibration_calibrate()), undefined);
assert.strictEqual(mount.querySelector("img"), image);
assert.equal(surface.style.transform, held);
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
await resetTo(m.calibration_source_proposal());
assert.equal(boxes(), 3, "resetting to the proposal replaces the draft");
assert.equal(checks(), 2, "a draft from the proposal keeps its checks");
await resetTo(m.calibration_source_review());
assert.equal(boxes(), 2, "resetting to the review restores the stored boxes");
assert.equal(checks(), 0);
await resetTo(m.calibration_source_proposal());
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
assert.equal(checks(), 0, "Undo restores the draft's lineage with its boxes");
assert.strictEqual(mount.querySelector("img"), image);
assert.equal(surface.style.transform, held);

saveStatus = "conflict";
await act(async () => button(m.calibration_save())!.click());
assert.ok(pending(button(m.calibration_saving())), "saving pends Save");
assert.ok(
  await refuses(button(m.calibration_saving())),
  "a pending Save refuses presses",
);
await act(async () => releaseSave?.());
const conflict = () =>
  Array.from(body.querySelectorAll('[role="status"]')).find((alert) =>
    alert.textContent?.includes(m.calibration_conflict()),
  );
assert.ok(conflict(), "a save conflict stays on the page");
assert.equal(
  button(m.calibration_save())?.getAttribute("aria-disabled"),
  "true",
  "a conflicted draft cannot be saved again",
);
assert.equal(boxes(), 2, "the draft survives the conflict");
await act(async () => button(m.calibration_reload())!.click());
await act(async () => {
  resolveAnnotation?.(latest);
});
assert.equal(conflict(), undefined, "reloading clears the conflict");
assert.equal(boxes(), 2, "the reloaded draft starts from the stored review");

saveStatus = "saved";
const save = button(m.calibration_save());
assert.ok(save);
assert.equal(pending(save), false);
await act(async () => {
  save.click();
});
await act(async () => releaseSave?.());
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
  held,
  "calibration must preserve scale and pan",
);
assert.equal(observed(), 1, "calibration must not remount the viewport");
assert.equal(disconnected(), 0);
await render(false);
assert.ok(button(m.calibration_calibrate()));
assert.strictEqual(mount.querySelector("img"), image);
assert.equal(
  surface.style.transform,
  held,
  "leaving calibration must preserve scale and pan",
);
assert.equal(observed(), 1);
await render(true);
assert.ok(pending(button(m.calibration_save())));
await render(false);
await act(async () => {
  resolveAnnotation?.(latest);
});
assert.ok(
  button(m.calibration_calibrate()),
  "a cancelled load must not start a session",
);
assert.equal(boxes(), 1);
assert.strictEqual(mount.querySelector("img"), image);
assert.equal(surface.style.transform, held);
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
  pending(button(m.calibration_save())),
  "a different model must load its own baseline",
);
assert.equal(boxes(), 1);
assert.strictEqual(mount.querySelector("img"), image);
assert.equal(surface.style.transform, held);
await act(async () => {
  resolveAnnotation?.(null);
});
assert.equal(boxes(), 0);
const otherSave = button(m.calibration_save());
assert.ok(otherSave);
assert.equal(pending(otherSave), false);
await act(async () => {
  otherSave.click();
});
await act(async () => releaseSave?.());
assert.equal(saved?.data.base, null);
assert.deepEqual(
  saved?.data.instances,
  [],
  "a first review must not inherit another model's annotation",
);
assert.equal(observed(), 1);
await unmount();
assert.equal(disconnected(), 1);
console.log("Calibration retains one viewport");

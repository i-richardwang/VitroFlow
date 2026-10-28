import assert from "node:assert/strict";
import { mock } from "bun:test";
import { act } from "react";
import { body, browser, byRole, press, render, unmount, waitFor } from "./dom";

const submissions: unknown[] = [];
mock.module("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: async () => {} }),
}));
mock.module("../src/functions/training", () => ({
  startTrainingRun: async (value: unknown) => {
    submissions.push(value);
  },
}));
const { TrainDialog } = await import("../src/features/training/TrainDialog");
const { TRAINING_PRESETS, DEFAULT_TRAINING_PRESET_ID } =
  await import("../src/domain/training/recipes");
const { m } = await import("../src/paraglide/messages");

try {
  await render(
    <TrainDialog
      open
      onClose={() => {}}
      set={{
        dataset: "test",
        reviewed: 10,
        trainingPresets: TRAINING_PRESETS,
        defaultTrainingPresetId: DEFAULT_TRAINING_PRESET_ID,
        training: {
          active: null,
          reviewedSinceLastRun: 10,
          workers: [],
          workerMemoryBytes: null,
        },
      }}
    />,
  );
  const field = (label: string) => {
    const element = Array.from(body.querySelectorAll(".ui-form-field")).find(
      (candidate) =>
        candidate.querySelector("label")?.textContent?.includes(label),
    );
    assert.ok(element, `field ${label} exists`);
    return element;
  };
  const value = (label: string) =>
    field(label).querySelector("input")?.value.replaceAll(",", "");
  const lowest = (label: string) =>
    act(async () => {
      field(label)
        .querySelector("input")!
        .dispatchEvent(
          new browser.KeyboardEvent("keydown", { key: "Home", bubbles: true }),
        );
    });
  /** The group its accessible name names. */
  const group = (title: string) => {
    const element = Array.from(body.querySelectorAll("fieldset")).find(
      (candidate) => {
        const name = candidate.getAttribute("aria-labelledby");
        return (
          name !== null &&
          browser.document.getElementById(name)?.textContent === title
        );
      },
    );
    assert.ok(element, `group ${title} exists`);
    return element;
  };
  const restore = (title: string) =>
    Array.from(group(title).querySelectorAll("button")).find(
      (element) => element.textContent === m.train_restore_preset(),
    );
  const choose = async (label: string) => {
    await press(field(m.train_preset()).querySelector('[role="combobox"]'));
    await press(
      await waitFor(
        () =>
          byRole("option").find((option) =>
            option.textContent?.includes(label),
          ),
        "preset options show",
      ),
    );
  };

  const form = body.querySelector("form")!;
  const missing = byRole("status").find((element) =>
    element.textContent?.includes(m.train_dialog_no_worker()),
  );
  assert.ok(
    missing &&
      missing.compareDocumentPosition(field(m.train_preset())) &
        browser.Node.DOCUMENT_POSITION_FOLLOWING,
    "the missing worker is said before any field",
  );
  const advanced = group(m.train_advanced_parameters()).querySelector(
    "[aria-expanded]",
  );
  assert.equal(
    advanced?.getAttribute("aria-expanded"),
    "false",
    "advanced parameters start closed",
  );
  assert.ok(!body.textContent?.includes(m.parameter_nbs()));
  assert.equal(restore(m.train_parameters()), undefined, "nothing to restore");

  assert.equal(value(m.parameter_batch()), "4");
  await press(field(m.parameter_batch()).querySelector("button"));
  await lowest(m.parameter_patience());
  assert.equal(value(m.parameter_patience()), "0");
  await choose(m.train_preset_s());
  assert.equal(value(m.parameter_batch()), "5", "an adjustment survives");
  assert.equal(value(m.parameter_imgsz()), "2048");
  await choose(m.train_preset_n());
  assert.equal(value(m.parameter_batch()), "5");
  assert.equal(
    value(m.parameter_patience()),
    "20",
    "an adjustment the other preset already made is dropped",
  );

  await press(advanced);
  assert.equal(value(m.parameter_nbs()), "64");
  assert.equal(restore(m.train_advanced_parameters()), undefined);
  await press(field(m.parameter_nbs()).querySelector("button"));
  await press(restore(m.train_parameters()));
  assert.equal(value(m.parameter_batch()), "4", "a group restores its fields");
  assert.equal(value(m.parameter_nbs()), "65", "and only its own");
  assert.equal(restore(m.train_parameters()), undefined);
  assert.ok(restore(m.train_advanced_parameters()));

  await lowest(m.parameter_lr0());
  await choose(m.train_preset_s());
  assert.equal(value(m.parameter_lr0()), "0.00001");
  await act(async () => {
    form.dispatchEvent(
      new browser.Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  assert.deepEqual(submissions, [
    {
      data: {
        dataset: "test",
        presetId: "yolo26s-whole-2048-v1",
        overrides: { nbs: 65, lr0: 0.00001 },
        targetWorkerId: null,
      },
    },
  ]);
  console.log("training presets behave");
} finally {
  await unmount();
}

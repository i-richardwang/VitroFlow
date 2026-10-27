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
  assert.equal(value(m.parameter_batch()), "4");
  await press(field(m.parameter_batch()).querySelector("button"));
  assert.equal(value(m.parameter_batch()), "5");
  const choose = async (label: string) => {
    await press(
      body.querySelector(`[aria-label="${m.train_dialog_preset_title()}"]`),
    );
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
  await choose(m.train_preset_s());
  assert.equal(
    value(m.parameter_batch()),
    "1",
    "switching clears the n override",
  );
  assert.equal(value(m.parameter_imgsz()), "2048");
  assert.equal(value(m.parameter_nbs()), "8");
  await choose(m.train_preset_n());
  assert.equal(value(m.parameter_batch()), "4");
  assert.equal(value(m.parameter_nbs()), "64");
  await choose(m.train_preset_s());
  await press(field(m.parameter_batch()).querySelector("button"));
  await act(async () => {
    field(m.parameter_lr0())
      .querySelector("input")!
      .dispatchEvent(
        new browser.KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      );
  });
  assert.equal(value(m.parameter_lr0()), "0.00001");
  await act(async () => {
    body
      .querySelector("form")!
      .dispatchEvent(
        new browser.Event("submit", { bubbles: true, cancelable: true }),
      );
  });
  assert.deepEqual(submissions, [
    {
      data: {
        dataset: "test",
        presetId: "yolo26s-whole-2048-v1",
        overrides: { batch: 2, lr0: 0.00001 },
        targetWorkerId: null,
      },
    },
  ]);
  console.log("training presets behave");
} finally {
  await unmount();
}

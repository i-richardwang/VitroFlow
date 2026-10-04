/** Isolated DOM harness for kit components; the scenario to run is the first argument. */
import assert from "node:assert/strict";
import { useState } from "react";

import { body, browser, byRole, press, render, unmount, waitFor } from "./dom";

const scenarios: Record<string, () => Promise<void>> = {
  async modal() {
    const { Modal } = await import("../src/ui/kit/Modal");
    function Dialog({ open }: { open: boolean }) {
      return (
        <Modal open={open} title="Rename" okText="Save" onClose={() => {}}>
          <input data-field="name" />
        </Modal>
      );
    }
    await render(<Dialog open />);
    assert.ok(body.querySelector("[data-field=name]"), "an open dialog shows");
    await render(<Dialog open={false} />);
    await waitFor(
      () => body.querySelector("[data-field=name]") === null,
      "a closed dialog unmounts its body, so reopening starts a fresh form",
    );
  },

  async select() {
    const { Select } = await import("../src/ui/kit/Select");
    const chosen: string[] = [];
    function Field() {
      const [value, setValue] = useState("a");
      return (
        <Select
          aria-label="Letter"
          options={[
            { label: "Alpha", value: "a" },
            { label: "Beta", value: "b" },
          ]}
          value={value}
          onChange={(next) => {
            chosen.push(next);
            setValue(next);
          }}
        />
      );
    }
    await render(<Field />);
    await press(body.querySelector('[aria-label="Letter"]'));
    const beta = await waitFor(
      () =>
        byRole("option").find((option) => option.textContent?.includes("Beta")),
      "the options show",
    );
    await press(beta);
    assert.deepEqual(chosen, ["b"], "choosing an option reports its value");
  },

  async dropdownMenu() {
    const { DropdownMenu } = await import("../src/ui/kit/DropdownMenu");
    const { Button } = await import("../src/ui/kit/Button");
    const ran: string[] = [];
    await render(
      <DropdownMenu
        items={[
          { key: "edit", label: "Edit", onClick: () => ran.push("edit") },
          { type: "divider" },
          {
            key: "delete",
            label: "Delete",
            danger: true,
            onClick: () => ran.push("delete"),
          },
        ]}
      >
        <Button aria-label="Actions" />
      </DropdownMenu>,
    );
    assert.equal(byRole("menuitem").length, 0, "a closed menu has no items");
    await press(body.querySelector('[aria-label="Actions"]'));
    await waitFor(
      () => byRole("menuitem").length === 2,
      "the trigger opens the menu",
    );
    await press(
      byRole("menuitem").find((item) => item.textContent === "Delete"),
    );
    assert.deepEqual(ran, ["delete"], "an item runs its onClick");
  },

  async form() {
    const { Form } = await import("../src/ui/kit/Form");
    const { Input } = await import("../src/ui/kit/Input");
    await render(
      <Form errors={{ email: "Already taken" }} onSubmit={() => {}}>
        <Form.Field label="Name" name="name">
          <Input />
        </Form.Field>
        <Form.Field label="Email" name="email">
          <Input />
        </Form.Field>
      </Form>,
    );
    /** The text of what describes the control labelled `label`. */
    const errorOf = (label: string) => {
      const owner = Array.from(body.querySelectorAll("label")).find(
        (element) => element.textContent === label,
      );
      const control = owner && browser.document.getElementById(owner.htmlFor);
      assert.ok(control, `a control is labelled ${label}`);
      const described = control.getAttribute("aria-describedby");
      if (!described) return null;
      return described
        .split(" ")
        .map((id) => browser.document.getElementById(id)?.textContent ?? "")
        .join("");
    };
    assert.equal(errorOf("Email"), "Already taken");
    assert.equal(errorOf("Name"), null, "other fields show no error");
  },
};

const name = process.argv[2] ?? "";
const scenario = scenarios[name];
assert.ok(scenario, `unknown scenario ${name}`);
await scenario();
await unmount();
console.log(`kit ${name} behaves`);
process.exit(0);

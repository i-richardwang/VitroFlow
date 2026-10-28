import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  UNCLEAR_NOTE_LENGTH,
  type UnclearDecision,
  type UnclearMark,
} from "../../domain/images/unclear";
import { clearUnclear, markUnclear } from "../../functions/images";
import { m } from "../../paraglide/messages";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Alert } from "../../ui/kit/Alert";
import { Checkbox } from "../../ui/kit/Checkbox";
import { Form } from "../../ui/kit/Form";
import { TextArea } from "../../ui/kit/Input";
import { Switch } from "../../ui/kit/Switch";
import { Tag } from "../../ui/kit/Tag";
import { WorkbenchSection } from "../../ui/shell/Workbench";

/**
 * Whether the photograph on view could be read clearly, said beside its
 * boxes and saved the moment it changes, apart from the review: the switch
 * marks it unclear or clears it, and a marked photograph can still be
 * counted, with a note on what makes it unclear. A new mark is not counted.
 */
export function UnclearSection({
  digest,
  mark,
}: {
  digest: string;
  mark: UnclearMark | null;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const save = async (decision: UnclearDecision | null) => {
    const result = await run(async () => {
      if (decision) await markUnclear({ data: { digest, ...decision } });
      else await clearUnclear({ data: { digest } });
    }, m.unclear_not_saved());
    if (result.ok) await router.invalidate();
  };

  return (
    <WorkbenchSection>
      <Form.Field
        layout="horizontal"
        label={m.unclear_section()}
        desc={m.unclear_switch_description()}
      >
        <Switch
          size="small"
          checked={mark !== null}
          disabled={busy}
          onChange={(on) => void save(on ? { counted: false, note: "" } : null)}
        />
      </Form.Field>
      {mark ? (
        <>
          <Checkbox
            checked={mark.counted}
            disabled={busy}
            onChange={(counted) => void save({ counted, note: mark.note })}
          >
            {m.unclear_counted_label()}
          </Checkbox>
          <UnclearNote
            key={mark.note}
            mark={mark}
            busy={busy}
            onSave={(note) => void save({ counted: mark.counted, note })}
          />
        </>
      ) : null}
    </WorkbenchSection>
  );
}

/**
 * The note on what makes the photograph unclear, saved when the field is
 * left. Keyed by the stored note, so one saved elsewhere replaces the draft.
 */
function UnclearNote({
  mark,
  busy,
  onSave,
}: {
  mark: UnclearMark;
  busy: boolean;
  onSave: (note: string) => void;
}) {
  const [note, setNote] = useState(mark.note);
  return (
    <Form.Field label={m.unclear_note_label()}>
      <TextArea
        autoSize={{ minRows: 2, maxRows: 6 }}
        disabled={busy}
        maxLength={UNCLEAR_NOTE_LENGTH}
        placeholder={m.unclear_note_placeholder()}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => {
          const trimmed = note.trim();
          if (trimmed !== mark.note) onSave(trimmed);
        }}
      />
    </Form.Field>
  );
}

/** A photograph's unclear mark, stated over it: counted or not, and its note. */
export function UnclearAlert({ mark }: { mark: UnclearMark }) {
  return (
    <Alert
      type="warning"
      title={mark.counted ? m.unclear_counted() : m.unclear_not_counted()}
      description={mark.note || undefined}
    />
  );
}

/** A photograph's unclear mark in a list, beside its other quality tags. */
export function UnclearTag({ mark }: { mark: UnclearMark }) {
  return (
    <Tag color="warning" size="small" title={mark.note || undefined}>
      {mark.counted ? m.unclear_counted() : m.unclear_not_counted()}
    </Tag>
  );
}

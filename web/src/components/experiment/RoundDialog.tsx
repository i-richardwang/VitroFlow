import type { DateValue } from "@internationalized/date";
import {
  getLocalTimeZone,
  now,
  toCalendarDateTime,
  toZoned,
} from "@internationalized/date";
import {
  Button,
  Calendar,
  DateField,
  DatePicker,
  Description,
  FieldError,
  Fieldset,
  Input,
  Label,
  Modal,
  TextField,
  TimeField,
} from "@heroui/react";
import { useState } from "react";

import { RoundForm, postJson } from "./RoundForm";
import type { ExperimentRound } from "../../experiments/schema";

/**
 * Adds one round of photographs. The first round decides which dishes the
 * experiment follows; every later one photographs those dishes again.
 */
export function RoundDialog({
  experiment,
  firstRound,
}: {
  experiment: string;
  firstRound: boolean;
}) {
  const [capturedAt, setCapturedAt] = useState<DateValue | null>(() =>
    now(getLocalTimeZone()),
  );
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="primary" onPress={() => setOpen(true)}>
        {firstRound ? "First round" : "New round"}
      </Button>
      <Modal isOpen={open} onOpenChange={setOpen}>
        <Modal.Backdrop>
          <Modal.Container size="lg">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>
                  {firstRound ? "Photograph the dishes" : "Photograph again"}
                </Modal.Heading>
                <Description>
                  {firstRound
                    ? "One photo per dish, named after the dish: A1.jpg is dish A1. These names become the rows of the experiment."
                    : "One photo per dish, named as in the first round. Dishes not photographed this time stay empty for this round."}
                </Description>
              </Modal.Header>
              <Modal.Body>
                <RoundForm
                  fields={(busy) => (
                    <Fieldset.Group>
                      <TextField
                        variant="secondary"
                        fullWidth
                        isRequired
                        isDisabled={busy}
                        name="label"
                      >
                        <Label>Round label</Label>
                        <Input placeholder="Day 1" />
                        <FieldError />
                      </TextField>
                      <CapturedAtPicker
                        busy={busy}
                        value={capturedAt}
                        onChange={setCapturedAt}
                      />
                    </Fieldset.Group>
                  )}
                  submitLabel="Add round"
                  busyLabel="Adding…"
                  onCancel={() => setOpen(false)}
                  onSubmit={async (photos, form) => {
                    if (capturedAt == null) {
                      throw new Error("Captured at is required");
                    }
                    const { round, photos: count } = await postJson<{
                      round: ExperimentRound;
                      photos: number;
                    }>(
                      `/api/experiments/${encodeURIComponent(experiment)}/rounds`,
                      {
                        label: String(form.get("label") ?? ""),
                        capturedAt: instant(capturedAt).toISOString(),
                        photos,
                      },
                    );
                    return `${round.label} added with ${count} ${count === 1 ? "photo" : "photos"}`;
                  }}
                  onComplete={() => setOpen(false)}
                />
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}

function instant(value: DateValue): Date {
  return toZoned(toCalendarDateTime(value), getLocalTimeZone()).toDate();
}

function CapturedAtPicker({
  busy,
  value,
  onChange,
}: {
  busy: boolean;
  value: DateValue | null;
  onChange: (value: DateValue | null) => void;
}) {
  return (
    <DatePicker
      className="w-full"
      granularity="minute"
      hideTimeZone
      hourCycle={24}
      isDisabled={busy}
      isRequired
      shouldForceLeadingZeros
      value={value}
      onChange={onChange}
    >
      {({ state }) => (
        <>
          <Label>Captured at</Label>
          <DateField.Group fullWidth variant="secondary">
            <DateField.Input>
              {(segment) => <DateField.Segment segment={segment} />}
            </DateField.Input>
            <DateField.Suffix>
              <DatePicker.Trigger>
                <DatePicker.TriggerIndicator />
              </DatePicker.Trigger>
            </DateField.Suffix>
          </DateField.Group>
          <FieldError />
          <DatePicker.Popover className="flex flex-col gap-3">
            <Calendar aria-label="Captured at">
              <Calendar.Header>
                <Calendar.YearPickerTrigger>
                  <Calendar.YearPickerTriggerHeading />
                  <Calendar.YearPickerTriggerIndicator />
                </Calendar.YearPickerTrigger>
                <Calendar.NavButton slot="previous" />
                <Calendar.NavButton slot="next" />
              </Calendar.Header>
              <Calendar.Grid>
                <Calendar.GridHeader>
                  {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
                </Calendar.GridHeader>
                <Calendar.GridBody>
                  {(date) => <Calendar.Cell date={date} />}
                </Calendar.GridBody>
              </Calendar.Grid>
              <Calendar.YearPickerGrid>
                <Calendar.YearPickerGridBody>
                  {({ year }) => <Calendar.YearPickerCell year={year} />}
                </Calendar.YearPickerGridBody>
              </Calendar.YearPickerGrid>
            </Calendar>
            <div className="flex items-center justify-between">
              <Label>Time</Label>
              <TimeField
                aria-label="Time"
                granularity="minute"
                hideTimeZone
                hourCycle={24}
                shouldForceLeadingZeros
                value={state.timeValue}
                onChange={(time) => {
                  if (time) state.setTimeValue(time);
                }}
              >
                <TimeField.Group variant="secondary">
                  <TimeField.Input>
                    {(segment) => <TimeField.Segment segment={segment} />}
                  </TimeField.Input>
                </TimeField.Group>
              </TimeField>
            </div>
          </DatePicker.Popover>
        </>
      )}
    </DatePicker>
  );
}

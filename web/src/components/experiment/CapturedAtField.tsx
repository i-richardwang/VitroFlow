import type { DateValue } from "@internationalized/date";
import {
  getLocalTimeZone,
  toCalendarDateTime,
  toZoned,
} from "@internationalized/date";
import {
  Calendar,
  DateField,
  DatePicker,
  FieldError,
  Label,
  TimeField,
} from "@heroui/react";

export function toInstant(value: DateValue): Date {
  return toZoned(toCalendarDateTime(value), getLocalTimeZone()).toDate();
}

export function CapturedAtField({
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

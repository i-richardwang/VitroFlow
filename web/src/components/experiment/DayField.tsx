import {
  CalendarDate,
  getLocalTimeZone,
  parseDate,
  today,
  type DateValue,
} from "@internationalized/date";
import {
  Calendar,
  DateField,
  DatePicker,
  FieldError,
  Label,
} from "@heroui/react";

import type { CalendarDay } from "../../experiments/schema";

export function toDay(value: DateValue): CalendarDay {
  return new CalendarDate(value.year, value.month, value.day).toString();
}

export function fromDay(day: CalendarDay): CalendarDate {
  return parseDate(day);
}

export function currentDay(): CalendarDate {
  return today(getLocalTimeZone());
}

export function DayField({
  label,
  busy,
  value,
  onChange,
  minValue,
}: {
  label: string;
  busy: boolean;
  value: DateValue | null;
  onChange: (value: DateValue | null) => void;
  minValue?: DateValue;
}) {
  return (
    <DatePicker
      className="w-full"
      granularity="day"
      isDisabled={busy}
      isRequired
      shouldForceLeadingZeros
      value={value}
      minValue={minValue}
      onChange={onChange}
    >
      <Label>{label}</Label>
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
      <DatePicker.Popover>
        <Calendar aria-label={label}>
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
      </DatePicker.Popover>
    </DatePicker>
  );
}

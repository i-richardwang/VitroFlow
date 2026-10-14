import type { Unit } from "../../domain/experiments/contracts";
import { formatFactor, type Treatment } from "../../domain/experiments/schema";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { Text } from "../../ui/kit/Text";
import { formatCount } from "../../ui/numbers";
import { TreatmentDot } from "./TreatmentDot";
import { TreatmentMenu } from "./TreatmentMenu";

/** The experiment's design: each treatment, what sets it apart, and how many units it holds. */
export function TreatmentsTable({
  experiment,
  treatments,
  units,
}: {
  experiment: string;
  treatments: readonly Treatment[];
  units: readonly Unit[];
}) {
  return (
    <Table aria-label={m.experiment_treatments()} narrow="cards">
      <TableHeader>
        <tr>
          <TableHead>{m.experiment_column_treatment()}</TableHead>
          <TableHead>{m.treatment_factor_label()}</TableHead>
          <TableHead>{m.treatment_note_label()}</TableHead>
          <TableHead className="w-24" numeric>
            {m.experiment_units()}
          </TableHead>
          <TableHead className="w-12">
            <span className="sr-only">{m.experiment_column_actions()}</span>
          </TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {treatments.map((treatment) => {
          const factor = formatFactor(treatment.factor);
          return (
            <TableRow key={treatment.id}>
              <TableCell cellSlot="title">
                <TreatmentName treatment={treatment} />
              </TableCell>
              <TableCell cellLabel={m.treatment_factor_label()}>
                {factor ? (
                  <Text as="span" type="secondary">
                    {factor}
                  </Text>
                ) : (
                  <Absent />
                )}
              </TableCell>
              <TableCell cellLabel={m.treatment_note_label()}>
                {treatment.note ? (
                  <Text as="span" type="secondary" className="line-clamp-2">
                    {treatment.note}
                  </Text>
                ) : (
                  <Absent />
                )}
              </TableCell>
              <TableCell cellLabel={m.experiment_units()} numeric>
                {formatCount(
                  units.filter((unit) => unit.treatment === treatment.id)
                    .length,
                )}
              </TableCell>
              <TableCell cellSlot="actions" className="text-end">
                <TreatmentMenu
                  experiment={experiment}
                  treatment={treatment}
                  deletable={treatments.length > 1}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** A treatment by its color and name. */
export function TreatmentName({ treatment }: { treatment: Treatment }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <TreatmentDot position={treatment.position} />
      <span className="truncate">{treatment.name}</span>
    </span>
  );
}

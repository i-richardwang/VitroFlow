import { Link } from "@tanstack/react-router";
import { FlaskConical, ImageIcon, Plus } from "lucide-react";
import { useState, type ReactElement } from "react";

import type {
  ObservationImageCell,
  Unit,
} from "../../domain/experiments/contracts";
import {
  observationOrdinals,
  unitIsAvailableAt,
  unitIsIncludedInAnalysis,
} from "../../domain/experiments/culture-events";
import { placedPhotos } from "../../domain/experiments/photos";
import {
  cellKey,
  observationCells,
  unitReading,
  type Reading,
} from "../../domain/experiments/readings";
import type { ExperimentObservation } from "../../domain/experiments/schema";
import type { getExperimentGrid } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { formatDay } from "../../ui/Day";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Button } from "../../ui/kit/Button";
import { cn } from "../../ui/kit/cn";
import { Icon } from "../../ui/kit/Icon";
import { Select } from "../../ui/kit/Select";
import { Status } from "../../ui/kit/Status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSelectionCell,
  TableSelectionHead,
} from "../../ui/kit/Table";
import { Tabs } from "../../ui/kit/Tabs";
import { Text } from "../../ui/kit/Text";
import { TextLink } from "../../ui/kit/TextLink";
import { Tooltip } from "../../ui/kit/Tooltip";
import { Page } from "../../ui/Page";
import { formatCount } from "../../ui/numbers";
import { ExperimentMenu } from "./ExperimentMenu";
import { observationQuestion } from "./labels";
import { RecordObservationDialog } from "./ObservationDialog";
import { ObservationMenu } from "./ObservationMenu";
import { TreatmentName, TreatmentsTable } from "./TreatmentsTable";
import { UnitSelectionBar } from "./UnitSelectionBar";

/**
 * The parts of an experiment, one on show at a time: its units and what they
 * read, then its design.
 */
export const EXPERIMENT_TABS = ["units", "treatments"] as const;

export type ExperimentTab = (typeof EXPERIMENT_TABS)[number];

type ExperimentGridData = NonNullable<
  Awaited<ReturnType<typeof getExperimentGrid>>
>;

/**
 * One experiment, in two tabs: its units, a row per unit with the treatment
 * it belongs to and what it read on each day, and its design, a row per
 * treatment.
 */
export function ExperimentGridView({
  data,
  tab,
  onTabChange,
}: {
  data: ExperimentGridData;
  tab: ExperimentTab;
  onTabChange: (tab: ExperimentTab) => void;
}) {
  const {
    experiment,
    treatments,
    units,
    observations,
    images,
    models,
    datasets,
  } = data;
  const [recording, setRecording] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [treatment, setTreatment] = useState<string | null>(null);

  const waiting = images.some((image) => image.state === "pending");
  useRouteRefresh(5000, waiting);

  const cells = observationCells(images);
  const ordinals = observationOrdinals(observations);
  const placed = placedPhotos(data);
  const hasRecords =
    images.length > 0 || units.some((unit) => unit.events.length > 0);
  const treatmentOf = new Map(treatments.map((item) => [item.id, item]));
  // A treatment's units stay together, in the design's order.
  const rows = treatments.flatMap((item) =>
    item.id === treatment || treatment === null
      ? units.filter((unit) => unit.treatment === item.id)
      : [],
  );
  const chosen = rows.filter((unit) => selected.has(unit.id));
  const select = (ids: readonly string[], on: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const unitHref = (unit: Unit, observation?: string) => ({
    to: "/experiments/$experiment/$unit" as const,
    params: { experiment: experiment.id, unit: unit.id },
    search: { observation },
  });

  // A column is one day; it names its model too when the days read for more
  // than one, and the classes it counts when it counts fewer than its model
  // finds, since values compare within a column and columns may ask
  // different questions.
  const asked = new Set(observations.map((item) => item.modelId));
  const question = (observation: ExperimentObservation) =>
    observationQuestion(
      observation,
      models.find((item) => item.id === observation.modelId),
      { nameModel: asked.size > 1 },
    );

  const unitsTab = (
    <>
      <Table
        aria-label={m.experiment_grid_label({
          experiment: experiment.name,
        })}
        size="small"
        toolbar={
          treatments.length > 1 ? (
            <Select
              aria-label={m.experiment_column_treatment()}
              allowClear
              className="w-48"
              options={treatments.map((item) => ({
                value: item.id,
                label: <TreatmentName treatment={item} />,
              }))}
              placeholder={m.experiment_units_all_treatments()}
              size="small"
              value={treatment}
              onChange={(value) => {
                setTreatment(value);
                setSelected(new Set());
              }}
            />
          ) : undefined
        }
      >
        <TableHeader>
          <tr>
            <TableSelectionHead
              fixed="start"
              checked={rows.length > 0 && chosen.length === rows.length}
              indeterminate={chosen.length > 0 && chosen.length < rows.length}
              disabled={rows.length === 0}
              onChange={(on) =>
                select(
                  rows.map((unit) => unit.id),
                  on,
                )
              }
            />
            <TableHead fixed="start" className="min-w-24">
              {m.experiment_column_unit()}
            </TableHead>
            <TableHead fixed="start" className="min-w-36">
              {m.experiment_column_treatment()}
            </TableHead>
            {observations.map((observation) => (
              <TableHead key={observation.id} className="min-w-28">
                <ObservationMenu
                  experiment={experiment.id}
                  inoculatedOn={experiment.inoculatedOn}
                  observation={observation}
                  observations={observations}
                  question={question(observation)}
                  units={units.filter((unit) =>
                    unitIsAvailableAt(unit.events, observation, ordinals),
                  )}
                  images={images.filter(
                    (image) => image.observation === observation.id,
                  )}
                  placed={placed}
                  models={models}
                  datasets={datasets
                    .filter(
                      (dataset) => dataset.modelId === observation.modelId,
                    )
                    .map(({ id, name }) => ({ id, name }))}
                />
              </TableHead>
            ))}
          </tr>
        </TableHeader>
        <TableBody>
          {rows.map((unit) => {
            const owner = treatmentOf.get(unit.treatment);
            return (
              <TableRow
                key={unit.id}
                data-state={selected.has(unit.id) ? "selected" : undefined}
                clickable
              >
                <TableSelectionCell
                  fixed="start"
                  aria-label={unit.code}
                  checked={selected.has(unit.id)}
                  onChange={(on) => select([unit.id], on)}
                />
                <TableCell fixed="start" cellSlot="title">
                  <TextLink render={<Link {...unitHref(unit)} />}>
                    {unit.code}
                  </TextLink>
                </TableCell>
                <TableCell fixed="start">
                  {owner ? <TreatmentName treatment={owner} /> : null}
                </TableCell>
                {observations.map((observation) => (
                  <TableCell key={observation.id}>
                    <UnitCell
                      image={cells.get(cellKey(unit.id, observation.id))}
                      reading={unitReading(cells, unit.id, observation)}
                      counted={unitIsIncludedInAnalysis(
                        unit.events,
                        observation,
                        ordinals,
                      )}
                      link={(content) => (
                        <TextLink
                          render={<Link {...unitHref(unit, observation.id)} />}
                        >
                          {content}
                        </TextLink>
                      )}
                    />
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="pointer-events-none sticky bottom-0 flex shrink-0 justify-center *:pointer-events-auto">
        <UnitSelectionBar
          experiment={experiment.id}
          units={chosen}
          treatments={treatments}
          observations={observations}
          onClear={() => setSelected(new Set())}
        />
      </div>
    </>
  );

  return (
    <Page
      title={experiment.name}
      icon={FlaskConical}
      meta={[
        experiment.plantMaterial,
        experiment.explantType,
        experiment.baseMedium,
        m.experiment_meta_inoculated({
          day: formatDay(experiment.inoculatedOn),
        }),
      ].filter(Boolean)}
      action={
        <>
          <Button type="primary" icon={Plus} onClick={() => setRecording(true)}>
            {m.observation_record()}
          </Button>
          <ExperimentMenu experiment={experiment} hasRecords={hasRecords} />
        </>
      }
    >
      <Tabs
        activeKey={tab}
        items={[
          { key: "units", label: m.experiment_units() },
          { key: "treatments", label: m.experiment_treatments() },
        ]}
        onChange={onTabChange}
      />
      {tab === "units" ? (
        unitsTab
      ) : (
        <TreatmentsTable
          experiment={experiment.id}
          treatments={treatments}
          units={units}
        />
      )}

      <RecordObservationDialog
        experiment={experiment.id}
        inoculatedOn={experiment.inoculatedOn}
        models={models}
        previous={observations.at(-1)}
        observations={observations}
        units={units}
        placed={placed}
        open={recording}
        onClose={() => setRecording(false)}
      />
    </Page>
  );
}

/**
 * A unit's count on one day, or why there is none. A count nobody has
 * reviewed yet is shown provisional; a photograph not yet counted shows as a
 * photograph, no photograph as absent, and only a failed count asks for
 * attention.
 */
function UnitCell({
  image,
  reading,
  counted,
  link,
}: {
  image: ObservationImageCell | undefined;
  reading: Reading | null;
  counted: boolean;
  link: (content: ReactElement) => ReactElement;
}) {
  if (!image) return <Absent />;
  if (reading) {
    const notes: string[] = [];
    if (reading.source !== "review") notes.push(m.experiment_cell_unreviewed());
    if (!counted) notes.push(m.experiment_cell_excluded());
    return explain(
      notes,
      link(
        <Text
          as="span"
          type={
            !counted
              ? "quaternary"
              : reading.source === "review"
                ? undefined
                : "tertiary"
          }
          weight={reading.source === "review" ? "medium" : undefined}
          className={cn("tabular-nums", !counted && "line-through")}
        >
          {formatCount(reading.count)}
        </Text>,
      ),
    );
  }
  if (image.state === "failed") {
    return explain(
      image.error ? [image.error] : [],
      link(<Status tone="error">{m.experiment_cell_failed()}</Status>),
    );
  }
  const waiting =
    image.state === "unread"
      ? m.experiment_cell_unread()
      : m.experiment_cell_waiting();
  return explain(
    [waiting],
    link(
      <Text as="span" type="tertiary">
        <Icon
          icon={ImageIcon}
          size={14}
          aria-label={waiting}
          className="align-middle"
        />
      </Text>,
    ),
  );
}

/** A cell's notes, one per line, in a tooltip over it. */
function explain(notes: readonly string[], control: ReactElement) {
  if (notes.length === 0) return control;
  return (
    <Tooltip
      title={
        <span className="flex max-w-xs flex-col">
          {notes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </span>
      }
    >
      {control}
    </Tooltip>
  );
}

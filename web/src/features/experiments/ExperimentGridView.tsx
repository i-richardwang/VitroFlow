import { Link, useRouter } from "@tanstack/react-router";
import { CalendarPlus, Download, Plus, Sparkles } from "lucide-react";
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
  treatmentSummary,
  unitReading,
  type Reading,
  type Summary,
} from "../../domain/experiments/readings";
import {
  formatFactor,
  type ExperimentObservation,
  type Treatment,
} from "../../domain/experiments/schema";
import type { Model } from "../../domain/models/schema";
import type { getExperimentGrid } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Button } from "../../ui/kit/Button";
import { cn } from "../../ui/kit/cn";
import { Empty } from "../../ui/kit/Empty";
import { Icon } from "../../ui/kit/Icon";
import {
  Table,
  TableBody,
  TableCell,
  TableGroupRow,
  TableHead,
  TableHeader,
  TableRow,
  TableSelectionCell,
  TableSelectionHead,
} from "../../ui/kit/Table";
import { TextLink } from "../../ui/kit/TextLink";
import { Tooltip } from "../../ui/kit/Tooltip";
import { modelName } from "../../ui/model-names";
import { Page } from "../../ui/Page";
import { formatCount } from "../../ui/readings";
import { ExperimentMenu } from "./ExperimentMenu";
import { ImageAnalysisStatus } from "./ImageAnalysisStatus";
import { joinFacts, observationLabel } from "./labels";
import { ObservationDialog } from "./ObservationDialog";
import { ObservationMenu } from "./ObservationMenu";
import { TreatmentDialog } from "./TreatmentDialog";
import { TreatmentDot } from "./TreatmentDot";
import { TreatmentMenu } from "./TreatmentMenu";
import { UnitSelectionBar } from "./UnitSelectionBar";
import { experimentWorkbookFilename } from "./workbook";

type Dialog = "treatment" | "observation";

export function ExperimentGridView({
  data,
}: {
  data: NonNullable<Awaited<ReturnType<typeof getExperimentGrid>>>;
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
  const router = useRouter();
  const [open, setOpen] = useState<Dialog | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const close = () => setOpen(null);

  const waiting = images.some((image) => image.state === "pending");
  useRouteRefresh(router, 5000, waiting);

  const cells = observationCells(images);
  const ordinals = observationOrdinals(observations);
  const placed = placedPhotos(data);
  const hasRecords =
    images.length > 0 || units.some((unit) => unit.events.length > 0);
  const groups = treatments.map((treatment) => ({
    treatment,
    units: units.filter((unit) => unit.treatment === treatment.id),
  }));
  const chosen = units.filter((unit) => selected.has(unit.id));
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

  return (
    <Page
      title={experiment.name}
      description={joinFacts(
        [
          experiment.plantMaterial,
          experiment.explantType,
          experiment.baseMedium,
        ].filter(Boolean),
      )}
      actions={
        <>
          <Button
            icon={Download}
            render={
              // The workbook is a file download, not a route.
              <a
                href={`/experiments/${experiment.id}/workbook`}
                download={experimentWorkbookFilename(experiment)}
              />
            }
          >
            {m.experiment_export()}
          </Button>
          <Button
            type="primary"
            icon={Plus}
            onClick={() => setOpen("observation")}
          >
            {m.observation_new()}
          </Button>
          <ExperimentMenu
            experiment={experiment}
            hasRecords={hasRecords}
            onNewTreatment={() => setOpen("treatment")}
          />
        </>
      }
    >
      <Table
        aria-label={m.experiment_grid_label({ experiment: experiment.name })}
        fill
        footer={
          observations.length === 0 ? (
            <Empty
              icon={CalendarPlus}
              title={m.experiment_no_observations()}
              description={m.experiment_no_observations_description()}
              action={
                <Button icon={Plus} onClick={() => setOpen("observation")}>
                  {m.observation_new()}
                </Button>
              }
            />
          ) : undefined
        }
      >
        <TableHeader>
          <tr>
            <TableSelectionHead
              fixed="start"
              checked={units.length > 0 && chosen.length === units.length}
              indeterminate={chosen.length > 0 && chosen.length < units.length}
              disabled={units.length === 0}
              onChange={(on) =>
                select(
                  units.map((unit) => unit.id),
                  on,
                )
              }
            />
            <TableHead fixed="start" className="min-w-50">
              {m.experiment_column_treatment()}
            </TableHead>
            {observations.map((observation) => (
              <TableHead key={observation.id} className="min-w-36">
                <ObservationMenu
                  experiment={experiment.id}
                  inoculatedOn={experiment.inoculatedOn}
                  observation={observation}
                  label={observationHeading(observation, observations, models)}
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
                    .map((dataset) => dataset.id)}
                />
              </TableHead>
            ))}
            <TableHead fixed="end" className="w-full">
              <span className="sr-only">{m.experiment_column_actions()}</span>
            </TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {groups.map(({ treatment, units: replicates }) => {
            const ids = replicates.map((unit) => unit.id);
            const count = ids.filter((id) => selected.has(id)).length;
            const all = ids.length > 0 && count === ids.length;
            return [
              <TableGroupRow
                key={treatment.id}
                data-state={all ? "selected" : undefined}
              >
                <TableSelectionCell
                  fixed="start"
                  aria-label={treatment.name}
                  checked={all}
                  indeterminate={count > 0 && !all}
                  disabled={ids.length === 0}
                  onChange={(on) => select(ids, on)}
                />
                <TableCell fixed="start">
                  <TreatmentName treatment={treatment} />
                </TableCell>
                {observations.map((observation) => (
                  <TableCell key={observation.id}>
                    <SummaryValue
                      summary={treatmentSummary(
                        cells,
                        replicates,
                        observation,
                        ordinals,
                      )}
                    />
                  </TableCell>
                ))}
                <TableCell fixed="end">
                  <div className="flex justify-end">
                    <TreatmentMenu
                      experiment={experiment.id}
                      treatment={treatment}
                      deletable={treatments.length > 1}
                    />
                  </div>
                </TableCell>
              </TableGroupRow>,
              ...replicates.map((unit) => (
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
                    <TextLink
                      className="ms-4 font-mono"
                      render={<Link {...unitHref(unit)} />}
                    >
                      {unit.code}
                    </TextLink>
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
                            render={
                              <Link {...unitHref(unit, observation.id)} />
                            }
                          >
                            {content}
                          </TextLink>
                        )}
                      />
                    </TableCell>
                  ))}
                  <TableCell fixed="end" />
                </TableRow>
              )),
            ];
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

      <TreatmentDialog
        experiment={experiment.id}
        treatment={null}
        open={open === "treatment"}
        onClose={close}
      />
      <ObservationDialog
        experiment={experiment.id}
        inoculatedOn={experiment.inoculatedOn}
        models={models}
        observation={null}
        previous={observations.at(-1)}
        open={open === "observation"}
        onClose={close}
      />
    </Page>
  );
}

/**
 * The column is the day, and the model as well when the days read for more than
 * one: values in a column are comparable, columns may ask different questions.
 */
function observationHeading(
  observation: ExperimentObservation,
  observations: readonly ExperimentObservation[],
  models: readonly Model[],
): string {
  const day = observationLabel(observation);
  const asked = new Set(observations.map((item) => item.modelId));
  const model = models.find((item) => item.id === observation.modelId);
  if (asked.size < 2 || !model) return day;
  return m.observation_heading({ day, model: modelName(model) });
}

function TreatmentName({ treatment }: { treatment: Treatment }) {
  const factor = formatFactor(treatment.factor);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <TreatmentDot position={treatment.position} />
      <span className="truncate">{treatment.name}</span>
      {factor ? (
        <span className="truncate text-xs font-normal text-fg-tertiary">
          {factor}
        </span>
      ) : null}
    </span>
  );
}

/** A treatment's mean at one observation, its spread and how many replicates it rests on. */
function SummaryValue({ summary }: { summary: Summary }) {
  if (summary.value === null) return <Absent />;
  return (
    <span className="whitespace-nowrap tabular-nums">
      {formatCount(summary.value)}
      {summary.deviation === null ? null : (
        <span className="ms-1 font-normal text-fg-secondary">
          {m.experiment_summary_deviation({
            deviation: formatCount(summary.deviation),
          })}
        </span>
      )}
      <span className="ms-2 text-xs font-normal text-fg-tertiary">
        {m.experiment_summary_sample({ count: summary.sampleSize })}
      </span>
    </span>
  );
}

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
    if (reading.source === "proposal") notes.push(m.experiment_cell_proposed());
    if (reading.detected !== null) {
      notes.push(
        m.experiment_cell_analyzed({ value: formatCount(reading.detected) }),
      );
    }
    if (!counted) notes.push(m.experiment_cell_excluded());
    const value = (
      <span
        className={cn(
          "inline-flex items-center gap-1 tabular-nums",
          reading.source === "review" && "font-semibold",
          !counted && "text-fg-quaternary line-through",
        )}
      >
        {formatCount(reading.count)}
        {reading.source === "proposal" ? (
          <Icon icon={Sparkles} size={12} className="text-info" />
        ) : null}
      </span>
    );
    return explain(notes, link(value));
  }
  return explain(
    image.state === "failed" && image.error ? [image.error] : [],
    link(<ImageAnalysisStatus state={image.state} />),
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

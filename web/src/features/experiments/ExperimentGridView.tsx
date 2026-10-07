import { Link } from "@tanstack/react-router";
import {
  CalendarPlus,
  ChartLine,
  FlaskConical,
  ImageIcon,
  Plus,
} from "lucide-react";
import { useState, type ReactElement } from "react";

import type {
  ObservationImageCell,
  ReplicateSummary,
  TrendDay,
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
  treatmentTrend,
  unitReading,
  type Reading,
} from "../../domain/experiments/readings";
import { formatFactor, type Treatment } from "../../domain/experiments/schema";
import type { getExperimentGrid } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { formatDay } from "../../ui/Day";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Button } from "../../ui/kit/Button";
import { cn } from "../../ui/kit/cn";
import { Card } from "../../ui/kit/Card";
import { Empty, EmptyPlace } from "../../ui/kit/Empty";
import { Icon } from "../../ui/kit/Icon";
import { LineChart } from "../../ui/kit/LineChart";
import { Skeleton } from "../../ui/kit/Skeleton";
import { Status } from "../../ui/kit/Status";
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
import { Page, PageSection } from "../../ui/Page";
import { modelName } from "../../ui/model-names";
import { formatCount } from "../../ui/numbers";
import { ExperimentMenu } from "./ExperimentMenu";
import { RecordObservationDialog } from "./ObservationDialog";
import { ObservationMenu } from "./ObservationMenu";
import { TreatmentDialog } from "./TreatmentDialog";
import { TreatmentDot } from "./TreatmentDot";
import { TreatmentMenu } from "./TreatmentMenu";
import { UnitSelectionBar } from "./UnitSelectionBar";
import { Text } from "../../ui/kit/Text";

type Dialog = "treatment" | "observation";

type ExperimentGridData = NonNullable<
  Awaited<ReturnType<typeof getExperimentGrid>>
>;

export function ExperimentGridView({ data }: { data: ExperimentGridData }) {
  const {
    experiment,
    treatments,
    units,
    observations,
    images,
    models,
    datasets,
  } = data;
  const [open, setOpen] = useState<Dialog | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const close = () => setOpen(null);

  const waiting = images.some((image) => image.state === "pending");
  useRouteRefresh(5000, waiting);

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

  const newObservation = (
    <Button type="primary" icon={Plus} onClick={() => setOpen("observation")}>
      {m.observation_record()}
    </Button>
  );
  // A column is one day; it names its model too when the days read for more
  // than one, since values compare within a column and columns may ask
  // different questions.
  const asked = new Set(observations.map((item) => item.modelId));
  const namedModel = (modelId: string) =>
    asked.size > 1 ? models.find((item) => item.id === modelId) : undefined;
  const trend = treatmentTrend(data);
  const newest = trend.at(-1);
  // The trend reads for the newest day's model, named when days differ.
  const trendModel = newest && namedModel(newest.observation.modelId);

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
          {observations.length > 0 ? newObservation : null}
          <ExperimentMenu
            experiment={experiment}
            hasRecords={hasRecords}
            onNewTreatment={() => setOpen("treatment")}
          />
        </>
      }
    >
      <PageSection
        title={
          trendModel
            ? m.experiment_trend_title_model({ model: modelName(trendModel) })
            : m.experiment_trend_title()
        }
      >
        {newest ? (
          <TreatmentTrend trend={trend} treatments={treatments} />
        ) : (
          <EmptyPlace variant="outlined">
            {observations.length === 0 ? (
              <Empty
                icon={CalendarPlus}
                title={m.experiment_no_observations()}
                description={m.experiment_no_observations_description()}
                action={newObservation}
              />
            ) : (
              <Empty icon={ChartLine} title={m.experiment_trend_empty()} />
            )}
          </EmptyPlace>
        )}
      </PageSection>
      <PageSection title={m.experiment_units()}>
        <Table
          aria-label={m.experiment_grid_label({ experiment: experiment.name })}
          size="small"
        >
          <TableHeader>
            <tr>
              <TableSelectionHead
                fixed="start"
                checked={units.length > 0 && chosen.length === units.length}
                indeterminate={
                  chosen.length > 0 && chosen.length < units.length
                }
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
                <TableHead key={observation.id} className="min-w-28">
                  <ObservationMenu
                    experiment={experiment.id}
                    inoculatedOn={experiment.inoculatedOn}
                    observation={observation}
                    observations={observations}
                    model={namedModel(observation.modelId)}
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
                        className="ms-4"
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
      </PageSection>
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
      <RecordObservationDialog
        experiment={experiment.id}
        inoculatedOn={experiment.inoculatedOn}
        models={models}
        previous={observations.at(-1)}
        observations={observations}
        units={units}
        placed={placed}
        open={open === "observation"}
        onClose={close}
      />
    </Page>
  );
}

/**
 * How the treatments compare over the days that read: each treatment's mean
 * per unit, one line each, in its own color.
 */
function TreatmentTrend({
  trend,
  treatments,
}: {
  trend: readonly TrendDay[];
  treatments: readonly Treatment[];
}) {
  return (
    <Card>
      <LineChart
        title={m.experiment_trend_value()}
        data={trend.map((day) => ({
          day: day.observation.day,
          ...Object.fromEntries(
            day.treatments.flatMap(({ treatment, summary }) =>
              summary.value === null ? [] : [[treatment, summary.value]],
            ),
          ),
        }))}
        index="day"
        indexTicks={trend.map((day) => day.observation.day)}
        indexFormatter={(day) => m.observation_day_label({ day })}
        categories={treatments.map((treatment) => treatment.id)}
        labels={Object.fromEntries(
          treatments.map((treatment) => [treatment.id, treatment.name]),
        )}
        height={TREND_HEIGHT}
        xAxisDomain={["dataMin", "dataMax"]}
        yAxisDomain={[0, "auto"]}
        valueFormatter={formatCount}
        tooltipLabelFormatter={(day) => m.observation_day_label({ day })}
        tooltipValueFormatter={formatCount}
      />
    </Card>
  );
}

const TREND_HEIGHT = 240;

/** The treatment comparison while it loads: its card holding the chart's place. */
export function TreatmentTrendSkeleton() {
  return (
    <Card>
      <Skeleton height={TREND_HEIGHT} />
    </Card>
  );
}

function TreatmentName({ treatment }: { treatment: Treatment }) {
  const factor = formatFactor(treatment.factor);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <TreatmentDot position={treatment.position} />
      <span className="truncate">{treatment.name}</span>
      {factor ? (
        <Text as="span" size="xs" type="tertiary" weight="regular" ellipsis>
          {factor}
        </Text>
      ) : null}
    </span>
  );
}

/** A treatment's mean at one observation, its spread and how many replicates it rests on. */
function SummaryValue({ summary }: { summary: ReplicateSummary }) {
  if (summary.value === null) return <Absent />;
  return (
    <span className="whitespace-nowrap tabular-nums">
      {formatCount(summary.value)}
      {summary.deviation === null ? null : (
        <Text as="span" type="secondary" weight="regular" className="ms-1">
          {m.experiment_summary_deviation({ deviation: summary.deviation })}
        </Text>
      )}
      <Text
        as="span"
        size="xs"
        type="tertiary"
        weight="regular"
        className="ms-2"
      >
        {m.experiment_summary_sample({ count: summary.sampleSize })}
      </Text>
    </span>
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

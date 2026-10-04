import { ReferenceLine } from "recharts";

import { m } from "../../paraglide/messages";
import type { TrainingEpoch } from "../../domain/training/schema";
import { Card } from "../../ui/kit/Card";
import { LineChart } from "../../ui/kit/LineChart";
import { Skeleton } from "../../ui/kit/Skeleton";
import { formatDecimal } from "../../ui/numbers";

interface Series {
  key: string;
  label: () => string;
  value: (epoch: TrainingEpoch) => number;
}

interface Panel {
  key: string;
  title: () => string;
  series: Series[];
  /** Metrics live in [0, 1]; losses take whatever range the run produces. */
  unit?: boolean;
}

function losses(split: "train" | "val"): Series[] {
  const components = [
    ["box", m.epoch_series_box_loss],
    ["classification", m.epoch_series_classification_loss],
    ["regression", m.epoch_series_regression_loss],
  ] as const;
  return components.map(([component, label]) => ({
    key: `${split}-${component}`,
    label,
    value: (epoch) => epoch[split][component],
  }));
}

const PANELS: Panel[] = [
  { key: "train", title: m.epoch_chart_train_loss, series: losses("train") },
  { key: "val", title: m.epoch_chart_val_loss, series: losses("val") },
  {
    key: "map",
    title: m.epoch_chart_map,
    unit: true,
    series: [
      {
        key: "map50",
        label: m.epoch_series_map50,
        value: (epoch) => epoch.map50,
      },
      {
        key: "map50To95",
        label: m.epoch_series_map50_95,
        value: (epoch) => epoch.map50To95,
      },
    ],
  },
  {
    key: "precision-recall",
    title: m.epoch_chart_precision_recall,
    unit: true,
    series: [
      {
        key: "precision",
        label: m.epoch_series_precision,
        value: (epoch) => epoch.precision,
      },
      {
        key: "recall",
        label: m.epoch_series_recall,
        value: (epoch) => epoch.recall,
      },
    ],
  },
];

const CHART_HEIGHT = 240;

/** Four panels of per-epoch curves; a dashed line marks the best epoch. */
export function EpochCharts({
  epochs,
  total,
  best,
}: {
  epochs: TrainingEpoch[];
  total: number;
  best: TrainingEpoch | null;
}) {
  return (
    <div className="grid gap-4 laptop:grid-cols-2">
      {PANELS.map((panel) => (
        <EpochChart
          key={panel.key}
          panel={panel}
          epochs={epochs}
          total={total}
          best={best}
        />
      ))}
    </div>
  );
}

/** `EpochCharts` while the run loads: the four titled panels, each holding a bone the chart's height. */
export function EpochChartsSkeleton() {
  return (
    <div aria-hidden className="grid gap-4 laptop:grid-cols-2">
      {PANELS.map((panel) => (
        <Card key={panel.key} title={panel.title()}>
          <Skeleton height={CHART_HEIGHT} />
        </Card>
      ))}
    </div>
  );
}

function EpochChart({
  panel,
  epochs,
  total,
  best,
}: {
  panel: Panel;
  epochs: TrainingEpoch[];
  total: number;
  best: TrainingEpoch | null;
}) {
  const data = epochs.map((epoch) => ({
    epoch: epoch.epoch,
    ...Object.fromEntries(
      panel.series.map((series) => [series.key, series.value(epoch)]),
    ),
  }));
  const categories = panel.series.map((series) => series.key);
  const names = Object.fromEntries(
    panel.series.map((series) => [series.key, series.label()]),
  );

  return (
    <Card title={panel.title()}>
      <LineChart
        data={data}
        index="epoch"
        categories={categories}
        labels={names}
        height={CHART_HEIGHT}
        xAxisDomain={[1, Math.max(total, 2)]}
        yAxisDomain={panel.unit ? [0, 1] : ["auto", "auto"]}
        valueFormatter={(value) => formatDecimal(value, 2)}
        tooltipLabelFormatter={(epoch) => m.epoch_tooltip_epoch({ epoch })}
        tooltipValueFormatter={(value) => formatDecimal(value, 4)}
      >
        {best && (
          <ReferenceLine
            x={best.epoch}
            stroke="var(--color-fg-quaternary)"
            strokeDasharray="4 3"
          />
        )}
      </LineChart>
    </Card>
  );
}

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { TrainingEpoch } from "../../training/schema";

interface Series {
  key: string;
  label: string;
  color: string;
  value: (epoch: TrainingEpoch) => number;
}

interface Panel {
  title: string;
  series: Series[];
  /** Metrics live in [0, 1]; losses take whatever range the run produces. */
  unit?: boolean;
}

const LOSS_COLORS = ["var(--accent)", "var(--warning)", "var(--danger)"];

function losses(split: "train" | "val"): Series[] {
  return (["box", "cls", "dfl"] as const).map((component, index) => ({
    key: `${split}-${component}`,
    label: `${component} loss`,
    color: LOSS_COLORS[index]!,
    value: (epoch) => epoch[split][component],
  }));
}

/** The panels of Ultralytics' `results.png`, grouped by what they answer. */
const PANELS: Panel[] = [
  { title: "Train loss", series: losses("train") },
  { title: "Validation loss", series: losses("val") },
  {
    title: "mAP",
    unit: true,
    series: [
      {
        key: "map50",
        label: "mAP50",
        color: "var(--accent)",
        value: (epoch) => epoch.map50,
      },
      {
        key: "map5095",
        label: "mAP50-95",
        color: "var(--success)",
        value: (epoch) => epoch.map5095,
      },
    ],
  },
  {
    title: "Precision and recall",
    unit: true,
    series: [
      {
        key: "precision",
        label: "Precision",
        color: "var(--accent)",
        value: (epoch) => epoch.precision,
      },
      {
        key: "recall",
        label: "Recall",
        color: "var(--warning)",
        value: (epoch) => epoch.recall,
      },
    ],
  },
];

/** Per-epoch curves for one attempt, with the best epoch marked. */
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
    <div className="grid gap-4 sm:grid-cols-2">
      {PANELS.map((panel) => (
        <EpochChart
          key={panel.title}
          panel={panel}
          epochs={epochs}
          total={total}
          best={best}
        />
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

  return (
    <figure className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{panel.title}</span>
        <span className="flex gap-3 text-xs text-muted">
          {panel.series.map((series) => (
            <span key={series.key} className="flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block size-2 rounded-full"
                style={{ background: series.color }}
              />
              {series.label}
            </span>
          ))}
        </span>
      </figcaption>
      <ResponsiveContainer
        width="100%"
        height={200}
        initialDimension={{ width: 400, height: 200 }}
      >
        <LineChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="epoch"
            type="number"
            domain={[1, Math.max(total, 2)]}
            allowDecimals={false}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            stroke="var(--border)"
          />
          <YAxis
            domain={panel.unit ? [0, 1] : ["auto", "auto"]}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickFormatter={(value: number) => value.toFixed(panel.unit ? 1 : 2)}
            stroke="var(--border)"
            width={48}
          />
          <Tooltip
            formatter={(value) =>
              typeof value === "number" ? value.toFixed(4) : String(value)
            }
            labelFormatter={(epoch) => `Epoch ${epoch}`}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--foreground)",
              fontSize: 12,
            }}
          />
          {best && (
            <ReferenceLine
              x={best.epoch}
              stroke="var(--muted)"
              strokeDasharray="4 2"
            />
          )}
          {panel.series.map((series) => (
            <Line
              key={series.key}
              type="monotone"
              dataKey={series.key}
              name={series.label}
              stroke={series.color}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}

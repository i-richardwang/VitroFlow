import { ChartTooltip } from "@heroui-pro/react/chart-tooltip";
import { LineChart } from "@heroui-pro/react/line-chart";
import { ReferenceLine } from "recharts";

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

const LOSS_COLORS = [
  "var(--chart-1, var(--accent))",
  "var(--chart-2, var(--warning))",
  "var(--chart-3, var(--danger))",
];

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
        color: "var(--chart-1, var(--accent))",
        value: (epoch) => epoch.map50,
      },
      {
        key: "map5095",
        label: "mAP50-95",
        color: "var(--chart-2, var(--success))",
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
        color: "var(--chart-1, var(--accent))",
        value: (epoch) => epoch.precision,
      },
      {
        key: "recall",
        label: "Recall",
        color: "var(--chart-3, var(--warning))",
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
    <div className="grid gap-6 sm:grid-cols-2">
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
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{panel.title}</span>
        <span className="flex gap-3 text-xs text-muted">
          {panel.series.map((series) => (
            <span key={series.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: series.color }}
              />
              {series.label}
            </span>
          ))}
        </span>
      </div>
      <LineChart
        data={data}
        height={200}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      >
        <LineChart.Grid vertical={false} />
        <LineChart.XAxis
          dataKey="epoch"
          type="number"
          domain={[1, Math.max(total, 2)]}
          allowDecimals={false}
          tickMargin={8}
        />
        <LineChart.YAxis
          domain={panel.unit ? [0, 1] : ["auto", "auto"]}
          tickFormatter={(value: number) => value.toFixed(panel.unit ? 1 : 2)}
          width={40}
        />
        {best && (
          <ReferenceLine
            x={best.epoch}
            stroke="var(--muted)"
            strokeDasharray="4 2"
          />
        )}
        {panel.series.map((series) => (
          <LineChart.Line
            key={series.key}
            type="monotone"
            dataKey={series.key}
            name={series.label}
            stroke={series.color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
        <LineChart.Tooltip
          content={({ active, label, payload }) => {
            if (!active || !payload?.length) return null;
            return (
              <ChartTooltip>
                <ChartTooltip.Header>Epoch {label}</ChartTooltip.Header>
                {payload.map((entry) => (
                  <ChartTooltip.Item key={String(entry.dataKey)}>
                    <ChartTooltip.Indicator
                      color={entry.color ?? entry.stroke}
                    />
                    <ChartTooltip.Label>{entry.name}</ChartTooltip.Label>
                    <ChartTooltip.Value>
                      {typeof entry.value === "number"
                        ? entry.value.toFixed(4)
                        : String(entry.value)}
                    </ChartTooltip.Value>
                  </ChartTooltip.Item>
                ))}
              </ChartTooltip>
            );
          }}
        />
      </LineChart>
    </div>
  );
}

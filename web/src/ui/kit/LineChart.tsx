import type { ReactNode } from "react";
import {
  CartesianGrid,
  Dot,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AxisDomain } from "recharts/types/util/types";
import { ChartTooltip } from "./ChartTooltip";
import { useClientValue } from "./clientValue";
import { chartColor, Legend } from "./Legend";

/*
 * A line per category over `data` against a numeric x axis keyed by `index`,
 * under a legend of the categories. Series take the chart colors in category
 * order. Recharts elements passed as `children` (reference lines) draw inside
 * the chart after the lines.
 */

export interface LineChartProps {
  categories: string[];
  /** Recharts elements drawn inside the chart after the lines. */
  children?: ReactNode;
  data: Record<string, number>[];
  height: number;
  index: string;
  /** Display names by category. */
  labels: Record<string, string>;
  /** Formats the hovered x value as the tooltip's title. */
  tooltipLabelFormatter: (label: number) => ReactNode;
  tooltipValueFormatter: (value: number) => string;
  /** Formats the value axis ticks. */
  valueFormatter: (value: number) => string;
  xAxisDomain: AxisDomain;
  yAxisDomain: AxisDomain;
}

/** Room for the hovered dot (radius 5) at the top edge of the plot. */
const DOT_RADIUS = 5;

const widths = new Map<string, number>();
let context: CanvasRenderingContext2D | null | undefined;

/** Width of `text` at the axis label size (12px, `--text-xs`) in the page font, cached per text. */
function textWidth(text: string): number {
  const cached = widths.get(text);
  if (cached !== undefined) return cached;
  if (context === undefined)
    context = document.createElement("canvas").getContext("2d");
  if (!context) return 0;
  context.font = `12px ${getComputedStyle(document.body).fontFamily}`;
  const width = context.measureText(text).width;
  widths.set(text, width);
  return width;
}

/**
 * Width of the value axis: the widest formatted value plus 16px. The text is
 * measured in the browser; the server and the first client frame use 16px.
 */
function useValueAxisWidth(
  data: Record<string, number>[],
  categories: string[],
  valueFormatter: (value: number) => string,
): number {
  let widest = "";
  for (const row of data) {
    for (const category of categories) {
      const formatted = valueFormatter(row[category]!);
      if (formatted.length > widest.length) widest = formatted;
    }
  }
  return useClientValue(() => textWidth(widest), 0) + 16;
}

export function LineChart({
  categories,
  children,
  data,
  height,
  index,
  labels,
  tooltipLabelFormatter,
  tooltipValueFormatter,
  valueFormatter,
  xAxisDomain,
  yAxisDomain,
}: LineChartProps) {
  const yAxisWidth = useValueAxisWidth(data, categories, valueFormatter);
  // A single point has no line to draw, so it shows as a dot.
  const lone = data.length === 1;

  return (
    <div className="ui-line-chart" style={{ height }}>
      <Legend categories={categories} labels={labels} />
      <div className="ui-line-chart-plot">
        <ResponsiveContainer>
          <RechartsLineChart data={data} margin={{ top: DOT_RADIUS }}>
            <CartesianGrid
              className="ui-line-chart-grid-lines"
              vertical={false}
            />
            <XAxis
              axisLine={false}
              className="ui-line-chart-label"
              dataKey={index}
              domain={xAxisDomain}
              interval="equidistantPreserveStart"
              padding={{ left: 20, right: 20 }}
              // Tick labels render in a layer outside the axis group, so they carry the label class themselves.
              tick={{
                className: "ui-line-chart-label",
                transform: "translate(0, 6)",
              }}
              tickLine={false}
              type="number"
            />
            <YAxis
              axisLine={false}
              className="ui-line-chart-label"
              domain={yAxisDomain}
              tick={(props) => (
                <text
                  className="ui-line-chart-label"
                  dy={4}
                  textAnchor="start"
                  x={0}
                  y={Number(props.y)}
                >
                  {valueFormatter(props.payload.value)}
                </text>
              )}
              tickLine={false}
              type="number"
              width={yAxisWidth}
            />
            <Tooltip
              content={({ active, payload, label }) =>
                active && payload ? (
                  <ChartTooltip
                    rows={payload.map((item) => {
                      const category = String(item.dataKey);
                      return {
                        color: chartColor(categories.indexOf(category)),
                        label: labels[category]!,
                        value: tooltipValueFormatter(Number(item.value)),
                      };
                    })}
                    title={tooltipLabelFormatter(Number(label))}
                  />
                ) : null
              }
              cursor={{ stroke: "var(--color-fg-secondary)", strokeWidth: 1 }}
              isAnimationActive={false}
              position={{ y: 0 }}
              wrapperStyle={{ outline: "none" }}
            />
            {categories.map((category, position) => {
              const color = chartColor(position);
              return (
                <Line
                  activeDot={(props) => (
                    <Dot
                      cx={props.cx}
                      cy={props.cy}
                      r={DOT_RADIUS}
                      stroke={props.stroke}
                      strokeWidth={props.strokeWidth}
                      style={{ fill: color }}
                    />
                  )}
                  dataKey={category}
                  dot={
                    lone
                      ? (props) => (
                          <Dot
                            cx={props.cx}
                            cy={props.cy}
                            r={DOT_RADIUS}
                            style={{ fill: color }}
                          />
                        )
                      : false
                  }
                  isAnimationActive={false}
                  key={category}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  style={{ stroke: color }}
                />
              );
            })}
            {children}
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

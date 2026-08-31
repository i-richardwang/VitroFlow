import { ColorSwatch } from "@heroui/react";

/** Stable categorical colors keyed by treatment position. */
const SERIES: readonly [light: string, dark: string][] = [
  ["#2a78d6", "#3987e5"],
  ["#eb6834", "#d95926"],
  ["#1baf7a", "#199e70"],
  ["#eda100", "#c98500"],
  ["#e87ba4", "#d55181"],
  ["#008300", "#008300"],
  ["#4a3aa7", "#9085e9"],
  ["#e34948", "#e66767"],
];

function seriesColor(position: number): [light: string, dark: string] {
  const curated = SERIES[position - 1];
  if (curated) return [...curated];
  const generated = position - SERIES.length - 1;
  const hue = (218 + generated * 137.507_764) % 360;
  const band = Math.floor(generated / 12) % 3;
  const lightness = [44, 52, 38][band]!;
  return [
    `hsl(${hue}, 65%, ${lightness}%)`,
    `hsl(${hue}, 62%, ${Math.min(lightness + 14, 66)}%)`,
  ];
}

/** The color swatch of a treatment. Transparent is unassigned. */
export function TreatmentDot({ position }: { position: number | null }) {
  const [light, dark] =
    position === null
      ? ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]
      : seriesColor(position);
  return (
    <ColorSwatch
      size="xs"
      shape="circle"
      color={light}
      aria-hidden
      style={
        position === null
          ? undefined
          : () => ({ backgroundColor: `light-dark(${light}, ${dark})` })
      }
    />
  );
}

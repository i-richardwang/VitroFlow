import { ColorSwatch } from "../../ui/kit/ColorSwatch";
import { chartColor } from "../../ui/kit/Legend";

/** The treatment's series color, the same wherever the treatment is named; positions cycle through the chart palette. */
export function TreatmentDot({ position }: { position: number }) {
  return <ColorSwatch color={chartColor(position - 1)} />;
}

import { Link } from "@tanstack/react-router";
import { FlaskConical, ImageOff } from "lucide-react";

import type { ExperimentSummary } from "../../domain/experiments/contracts";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { formatDay } from "../../ui/Day";
import { Icon } from "../../ui/kit/Icon";
import {
  SummaryCard,
  SummaryCardBand,
  SummaryCardStats,
} from "../../ui/kit/SummaryCard";
import { formatCount } from "../../ui/numbers";
import { joinFacts, observationLabel } from "./labels";
import { TreatmentDot } from "./TreatmentDot";

const SHOWN_TREATMENTS = 4;

/**
 * An experiment on the overview: what it grows and when it was inoculated,
 * how its treatments compare on the newest day that reads, and its size.
 */
export function ExperimentCard({
  summary: { experiment, treatments, observations, photos, latest },
}: {
  summary: ExperimentSummary;
}) {
  return (
    <SummaryCard
      icon={FlaskConical}
      title={experiment.name}
      description={joinFacts(
        [
          experiment.plantMaterial,
          experiment.explantType,
          m.experiment_meta_inoculated({
            day: formatDay(experiment.inoculatedOn),
          }),
        ].filter(Boolean),
      )}
      render={
        <Link
          to="/experiments/$experiment"
          params={{ experiment: experiment.id }}
        />
      }
      footer={
        <SummaryCardStats
          items={[
            {
              label: m.experiment_stat_treatments(),
              value: formatCount(treatments.length),
            },
            {
              label: m.experiment_stat_observations(),
              value: formatCount(observations),
            },
            {
              label: m.experiment_card_photos(),
              value: formatCount(photos),
            },
          ]}
        />
      }
    >
      {latest ? (
        <SummaryCardBand>
          <span className="text-xs text-fg-tertiary">
            {m.experiment_card_latest({
              day: observationLabel(latest.observation),
            })}
          </span>
          <SummaryCardStats
            items={[
              ...treatments.slice(0, SHOWN_TREATMENTS).map((treatment) => {
                const value = latest.treatments.find(
                  (item) => item.treatment === treatment.id,
                )?.summary.value;
                return {
                  label: (
                    <span className="flex items-center gap-1.5">
                      <TreatmentDot position={treatment.position} />
                      {treatment.name}
                    </span>
                  ),
                  value:
                    value === null || value === undefined ? (
                      <Absent />
                    ) : (
                      formatCount(value)
                    ),
                };
              }),
              ...(treatments.length > SHOWN_TREATMENTS
                ? [
                    {
                      label: m.experiment_card_more_treatments_label(),
                      value: m.experiment_card_more_treatments({
                        count: treatments.length - SHOWN_TREATMENTS,
                      }),
                    },
                  ]
                : []),
            ]}
          />
        </SummaryCardBand>
      ) : (
        <SummaryCardBand variant="empty">
          <Icon icon={ImageOff} size={24} className="text-fg-quaternary" />
          <span>
            {photos > 0
              ? m.experiment_card_no_readings()
              : m.experiment_card_no_photos()}
          </span>
        </SummaryCardBand>
      )}
    </SummaryCard>
  );
}

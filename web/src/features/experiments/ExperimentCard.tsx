import { Link } from "@tanstack/react-router";
import { FlaskConical, ImageOff } from "lucide-react";

import type { ExperimentSummary } from "../../domain/experiments/contracts";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { formatDay } from "../../ui/Day";
import { Icon } from "../../ui/kit/Icon";
import { SegmentBar } from "../../ui/kit/SegmentBar";
import {
  SummaryCard,
  SummaryCardBand,
  SummaryCardMetric,
  SummaryCardStats,
} from "../../ui/kit/SummaryCard";
import { Tag } from "../../ui/kit/Tag";
import { formatCount } from "../../ui/numbers";
import {
  ImageAnalysisStatus,
  summarizedImageAnalysis,
} from "./ImageAnalysisStatus";
import { joinFacts } from "./labels";

const SHOWN_TREATMENTS = 4;

/**
 * An experiment on the overview: what it grows and when it was inoculated,
 * how far detection has gone through its photographs, its counts, and its
 * treatments.
 */
export function ExperimentCard({
  summary: { experiment, treatmentNames, latestDay, counts },
}: {
  summary: ExperimentSummary;
}) {
  const total =
    counts.unread +
    counts.pending +
    counts.failed +
    counts.analyzed +
    counts.proposed;
  const state = summarizedImageAnalysis(counts);
  const hidden = treatmentNames.length - SHOWN_TREATMENTS;
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
        <>
          <SummaryCardStats
            items={[
              {
                label: m.experiment_stat_treatments(),
                value: formatCount(treatmentNames.length),
              },
              {
                label: m.experiment_card_latest(),
                value:
                  latestDay === null ? (
                    <Absent />
                  ) : (
                    m.observation_day_label({ day: latestDay })
                  ),
              },
              {
                label: m.experiment_card_photos(),
                value: formatCount(total),
              },
            ]}
          />
          {treatmentNames.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {treatmentNames.slice(0, SHOWN_TREATMENTS).map((name) => (
                <Tag key={name} size="small">
                  {name}
                </Tag>
              ))}
              {hidden > 0 ? (
                <Tag size="small">
                  {m.experiment_card_more_treatments({ count: hidden })}
                </Tag>
              ) : null}
            </div>
          ) : null}
        </>
      }
    >
      {total > 0 ? (
        <SummaryCardBand
          aside={
            <SegmentBar
              aria-label={m.experiment_stat_images()}
              size="small"
              segments={[
                { color: "var(--color-success)", value: counts.analyzed },
                { color: "var(--color-info)", value: counts.proposed },
                { color: "var(--color-warning)", value: counts.pending },
                { color: "var(--color-error)", value: counts.failed },
              ]}
            />
          }
        >
          <SummaryCardMetric
            value={m.experiment_stat_images_value({
              analyzed: counts.analyzed,
              total,
            })}
            label={m.experiment_stat_images()}
            status={state ? <ImageAnalysisStatus state={state} /> : null}
          />
        </SummaryCardBand>
      ) : (
        <SummaryCardBand variant="empty">
          <Icon icon={ImageOff} size={24} className="text-fg-quaternary" />
          <span>{m.experiment_card_no_photos()}</span>
          <span className="text-xs text-fg-quaternary">
            {m.experiment_card_no_photos_hint()}
          </span>
        </SummaryCardBand>
      )}
    </SummaryCard>
  );
}

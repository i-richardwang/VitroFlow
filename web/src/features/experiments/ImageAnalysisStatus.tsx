import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import type { ImageAnalysisState } from "../../domain/experiments/schema";
import { m } from "../../paraglide/messages";
import { Status, type StatusTone } from "../../ui/kit/Status";

const DISPLAY: Record<
  ImageAnalysisState,
  { label: () => string; icon: LucideIcon; tone: StatusTone }
> = {
  unread: {
    label: m.image_analysis_unread,
    icon: CircleDashed,
    tone: "neutral",
  },
  pending: {
    label: m.image_analysis_pending,
    icon: Clock,
    tone: "warning",
  },
  analyzed: {
    label: m.image_analysis_analyzed,
    icon: CircleCheck,
    tone: "success",
  },
  failed: {
    label: m.image_analysis_failed,
    icon: CircleX,
    tone: "error",
  },
  proposed: {
    label: m.image_analysis_proposed,
    icon: Sparkles,
    tone: "info",
  },
};

/** Where a photograph, or an experiment's photographs, stand in detection. */
export function ImageAnalysisStatus({ state }: { state: ImageAnalysisState }) {
  const { label, icon, tone } = DISPLAY[state];
  return (
    <Status tone={tone} icon={icon}>
      {label()}
    </Status>
  );
}

export function summarizedImageAnalysis(
  counts: Record<ImageAnalysisState, number>,
): ImageAnalysisState | null {
  if (counts.failed > 0) return "failed";
  if (counts.pending > 0) return "pending";
  if (counts.unread > 0) return "unread";
  if (counts.proposed > 0) return "proposed";
  if (counts.analyzed > 0) return "analyzed";
  return null;
}

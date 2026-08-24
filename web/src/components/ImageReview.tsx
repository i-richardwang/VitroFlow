import { Link } from '@tanstack/react-router'

import { formatDelta } from '../format'
import { useCalibration } from '../hooks/useCalibration'
import type { CalibrationEdit, SeedResult } from '../schemas'
import { ImageViewer } from './ImageViewer'
import { QualityWarnings } from './QualityWarnings'

export function ImageReview({
  runId,
  stem,
  result,
  calibration: initial,
}: {
  runId: string
  stem: string
  result: SeedResult
  calibration: CalibrationEdit
}) {
  const calibration = useCalibration(runId, stem, initial)
  const { removed, added } = calibration.edit
  const count = result.count - removed.length + added.length
  const edited = removed.length > 0 || added.length > 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-6">
        <nav className="flex items-center gap-1.5 text-neutral-400">
          <Link to="/runs/$runId" params={{ runId }} className="font-mono hover:text-neutral-900">
            {runId}
          </Link>
          <span>/</span>
          <span className="font-mono font-semibold text-neutral-900">{stem}</span>
        </nav>
        <span className="h-4 w-px bg-neutral-200" />
        <span className="font-mono tabular-nums text-neutral-500">{count} seeds</span>
        {count !== result.count && (
          <span className="font-mono tabular-nums text-neutral-400">
            {formatDelta(count - result.count)}
          </span>
        )}
        <QualityWarnings quality={result.quality} />
        {edited && (
          <span className="ml-auto text-xs text-neutral-400">
            {calibration.saving ? 'Saving…' : 'Saved'}
          </span>
        )}
      </div>
      <ImageViewer runId={runId} stem={stem} result={result} calibration={calibration} />
    </div>
  )
}

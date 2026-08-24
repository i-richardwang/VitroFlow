import { Chip } from '@heroui/react'

import type { SeedQuality, SeedWarning } from '../schemas'

const WARNING_LABELS: Record<SeedWarning, string> = {
  dish_detection_failed: 'Dish not detected',
  exposure_clipping: 'Exposure clipped',
  low_focus: 'Low focus',
}

export function QualityWarnings({ quality }: { quality: SeedQuality }) {
  if (quality.status === 'ok') {
    return null
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {quality.warnings.map((warning) => (
        <Chip key={warning} color="warning" size="sm">
          {WARNING_LABELS[warning]}
        </Chip>
      ))}
    </span>
  )
}

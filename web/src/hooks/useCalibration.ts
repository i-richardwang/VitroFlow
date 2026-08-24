import { useState } from 'react'

import type { CalibrationEdit, Point } from '../schemas'
import { saveCalibration } from '../server/runs'

export interface CalibrationState {
  edit: CalibrationEdit
  saving: boolean
  toggleDetection: (id: number) => void
  addPoint: (point: Point) => void
  removePoint: (index: number) => void
}

export function useCalibration(
  runId: string,
  stem: string,
  initial: CalibrationEdit,
): CalibrationState {
  const [edit, setEdit] = useState(initial)
  const [saving, setSaving] = useState(false)

  const apply = (next: CalibrationEdit) => {
    setEdit(next)
    setSaving(true)
    saveCalibration({ data: { runId, stem, edit: next } }).finally(() => setSaving(false))
  }

  return {
    edit,
    saving,
    toggleDetection: (id) =>
      apply({
        ...edit,
        removed: edit.removed.includes(id)
          ? edit.removed.filter((removed) => removed !== id)
          : [...edit.removed, id],
      }),
    addPoint: (point) => apply({ ...edit, added: [...edit.added, point] }),
    removePoint: (index) =>
      apply({ ...edit, added: edit.added.filter((_, current) => current !== index) }),
  }
}

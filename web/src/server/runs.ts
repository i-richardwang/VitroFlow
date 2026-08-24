import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { calibrationEditSchema, type CalibrationEdit } from '../schemas'
import {
  listRunIds,
  listStems,
  readCalibration,
  readResult,
  writeCalibration,
} from './store'

export const listRuns = createServerFn({ method: 'GET' }).handler(() =>
  listRunIds().map((runId) => {
    const images = listStems(runId).map((stem) => ({
      result: readResult(runId, stem),
      calibration: readCalibration(runId, stem),
    }))
    const algorithmTotal = images.reduce((sum, image) => sum + image.result.count, 0)
    const calibratedTotal = images.reduce(
      (sum, image) => sum + (image.calibration?.count.calibrated ?? image.result.count),
      0,
    )
    return {
      runId,
      imageCount: images.length,
      totalCount: calibratedTotal,
      delta: calibratedTotal - algorithmTotal,
      flaggedCount: images.filter((image) => image.result.quality.status !== 'ok').length,
    }
  }),
)

export const getRun = createServerFn({ method: 'GET' })
  .validator(z.object({ runId: z.string() }))
  .handler(({ data }) =>
    listStems(data.runId).map((stem) => {
      const result = readResult(data.runId, stem)
      const calibration = readCalibration(data.runId, stem)
      return {
        stem,
        count: calibration?.count.calibrated ?? result.count,
        delta: (calibration?.count.calibrated ?? result.count) - result.count,
        quality: result.quality,
      }
    }),
  )

export const getImage = createServerFn({ method: 'GET' })
  .validator(z.object({ runId: z.string(), stem: z.string() }))
  .handler(({ data }) => {
    const calibration = readCalibration(data.runId, data.stem)
    const edit: CalibrationEdit = {
      removed: calibration?.removed.map((detection) => detection.id) ?? [],
      added: calibration?.added ?? [],
    }
    return { result: readResult(data.runId, data.stem), calibration: edit }
  })

export const saveCalibration = createServerFn({ method: 'POST' })
  .validator(z.object({ runId: z.string(), stem: z.string(), edit: calibrationEditSchema }))
  .handler(({ data }) => {
    writeCalibration(data.runId, data.stem, data.edit)
  })

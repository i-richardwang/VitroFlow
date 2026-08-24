import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { listRunIds, listStems, readResult } from './store'

export const listRuns = createServerFn({ method: 'GET' }).handler(() =>
  listRunIds().map((runId) => {
    const results = listStems(runId).map((stem) => readResult(runId, stem))
    return {
      runId,
      imageCount: results.length,
      totalCount: results.reduce((sum, result) => sum + result.count, 0),
      flaggedCount: results.filter((result) => result.quality.status !== 'ok').length,
    }
  }),
)

export const getRun = createServerFn({ method: 'GET' })
  .validator(z.object({ runId: z.string() }))
  .handler(({ data }) =>
    listStems(data.runId).map((stem) => {
      const result = readResult(data.runId, stem)
      return {
        stem,
        count: result.count,
        quality: result.quality,
      }
    }),
  )

export const getImageResult = createServerFn({ method: 'GET' })
  .validator(z.object({ runId: z.string(), stem: z.string() }))
  .handler(({ data }) => readResult(data.runId, data.stem))

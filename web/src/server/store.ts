import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  calibrationSchema,
  resultSchema,
  type Calibration,
  type CalibrationEdit,
  type SeedResult,
} from '../schemas'

const REPO_ROOT = path.resolve(process.cwd(), '..')
const RUNS_DIR = path.join(REPO_ROOT, 'data', 'runs')
const CALIBRATION_DIR = path.join(REPO_ROOT, 'data', 'calibration')

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
}

/** Joins a path under a data root, rejecting segments that could escape it. */
function safeJoin(root: string, ...segments: string[]): string {
  for (const segment of segments) {
    if (segment !== path.basename(segment)) {
      throw new Error(`Invalid path segment: ${segment}`)
    }
  }
  return path.join(root, ...segments)
}

export function listRunIds(): string[] {
  if (!fs.existsSync(RUNS_DIR)) {
    return []
  }
  return fs
    .readdirSync(RUNS_DIR)
    .filter((name) => fs.statSync(path.join(RUNS_DIR, name)).isDirectory())
    .sort()
    .reverse()
}

export function listStems(runId: string): string[] {
  return fs
    .readdirSync(safeJoin(RUNS_DIR, runId))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort()
}

export function readResult(runId: string, stem: string): SeedResult {
  const raw = fs.readFileSync(safeJoin(RUNS_DIR, runId, `${stem}.json`), 'utf-8')
  return resultSchema.parse(JSON.parse(raw))
}

export function readCalibration(runId: string, stem: string): Calibration | null {
  const filePath = safeJoin(CALIBRATION_DIR, runId, `${stem}.json`)
  if (!fs.existsSync(filePath)) {
    return null
  }
  return calibrationSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf-8')))
}

export function writeCalibration(runId: string, stem: string, edit: CalibrationEdit): void {
  const filePath = safeJoin(CALIBRATION_DIR, runId, `${stem}.json`)
  if (edit.removed.length === 0 && edit.added.length === 0) {
    fs.rmSync(filePath, { force: true })
    return
  }

  const result = readResult(runId, stem)
  const detections = new Map(result.detections.map((detection) => [detection.id, detection]))
  const calibration: Calibration = {
    image: result.source,
    run: runId,
    count: {
      algorithm: result.count,
      calibrated: result.count - edit.removed.length + edit.added.length,
    },
    removed: edit.removed.map((id) => {
      const detection = detections.get(id)
      if (!detection) {
        throw new Error(`Unknown detection: ${id}`)
      }
      return { id, x: detection.x, y: detection.y }
    }),
    added: edit.added,
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(calibration, null, 2)}\n`)
}

export const IMAGE_KINDS = ['source', 'overlay', 'debug'] as const

type ImageKind = (typeof IMAGE_KINDS)[number]

export function readRunImage(
  runId: string,
  stem: string,
  kind: ImageKind,
): { body: Uint8Array<ArrayBuffer>; contentType: string } | null {
  const filePath =
    kind === 'source'
      ? path.resolve(REPO_ROOT, readResult(runId, stem).source)
      : safeJoin(RUNS_DIR, runId, `${stem}_${kind}.jpg`)
  if (!fs.existsSync(filePath)) {
    return null
  }
  return {
    body: new Uint8Array(fs.readFileSync(filePath)),
    contentType: CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
  }
}

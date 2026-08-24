import * as fs from 'node:fs'
import * as path from 'node:path'

import { resultSchema, type SeedResult } from '../schemas'

const RUNS_DIR = path.join(process.cwd(), 'data', 'runs')
const REPO_ROOT = path.resolve(process.cwd(), '..')

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
}

/** Joins a path inside the runs directory, rejecting segments that could escape it. */
function runPath(runId: string, ...segments: string[]): string {
  for (const segment of [runId, ...segments]) {
    if (segment !== path.basename(segment)) {
      throw new Error(`Invalid path segment: ${segment}`)
    }
  }
  return path.join(RUNS_DIR, runId, ...segments)
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
    .readdirSync(runPath(runId))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort()
}

export function readResult(runId: string, stem: string): SeedResult {
  const raw = fs.readFileSync(runPath(runId, `${stem}.json`), 'utf-8')
  return resultSchema.parse(JSON.parse(raw))
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
      : runPath(runId, `${stem}_${kind}.jpg`)
  if (!fs.existsSync(filePath)) {
    return null
  }
  return {
    body: new Uint8Array(fs.readFileSync(filePath)),
    contentType: CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
  }
}

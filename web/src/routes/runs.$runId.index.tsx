import { Link, createFileRoute } from '@tanstack/react-router'

import { CountCell } from '../components/CountCell'
import { QualityWarnings } from '../components/QualityWarnings'
import { formatDelta } from '../format'
import { getRun } from '../server/runs'

export const Route = createFileRoute('/runs/$runId/')({
  loader: ({ params }) => getRun({ data: { runId: params.runId } }),
  component: RunPage,
})

const COLUMNS = 'grid grid-cols-[minmax(0,1fr)_8rem_14rem] items-center px-5'

function RunPage() {
  const { runId } = Route.useParams()
  const images = Route.useLoaderData()
  const totalCount = images.reduce((sum, image) => sum + image.count, 0)
  const totalDelta = images.reduce((sum, image) => sum + image.delta, 0)

  return (
    <main className="mx-auto max-w-3xl px-8 py-10">
      <nav className="text-neutral-400">
        <Link to="/" className="hover:text-neutral-900">
          Runs
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-neutral-900">{runId}</span>
      </nav>

      <header className="mt-3 flex items-end justify-between">
        <h1 className="font-mono text-xl font-semibold tracking-tight">{runId}</h1>
        <dl className="flex gap-8 text-right">
          <Stat label="Images" value={images.length} />
          <Stat label="Total" value={totalCount} delta={totalDelta} />
        </dl>
      </header>

      <div className="mt-8 overflow-hidden rounded-[10px] border border-neutral-200 bg-white">
        <div
          className={`${COLUMNS} border-b border-neutral-200 py-2.5 text-[11px] tracking-wider text-neutral-400 uppercase`}
        >
          <span>Image</span>
          <span className="text-right">Count</span>
          <span className="pl-8">Quality</span>
        </div>
        <ul className="divide-y divide-neutral-100">
          {images.map((image) => (
            <li key={image.stem}>
              <Link
                to="/runs/$runId/$stem"
                params={{ runId, stem: image.stem }}
                className={`${COLUMNS} py-3 hover:bg-neutral-50`}
              >
                <span className="truncate font-mono font-medium">{image.stem}</span>
                <CountCell count={image.count} delta={image.delta} />
                <span className="pl-8">
                  {image.quality.status === 'ok' ? (
                    <span className="text-neutral-300">—</span>
                  ) : (
                    <QualityWarnings quality={image.quality} />
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}

function Stat({ label, value, delta = 0 }: { label: string; value: number; delta?: number }) {
  return (
    <div>
      <dt className="text-[11px] tracking-wider text-neutral-400 uppercase">{label}</dt>
      <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
        {value}
        {delta !== 0 && (
          <span className="pl-1.5 text-sm font-normal text-neutral-400">{formatDelta(delta)}</span>
        )}
      </dd>
    </div>
  )
}

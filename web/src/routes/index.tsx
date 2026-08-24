import { Link, createFileRoute } from '@tanstack/react-router'

import { CountCell } from '../components/CountCell'
import { listRuns } from '../server/runs'

export const Route = createFileRoute('/')({
  loader: () => listRuns(),
  component: RunsPage,
})

const COLUMNS = 'grid grid-cols-[minmax(0,1fr)_5rem_8rem_7rem] items-center px-5'

function RunsPage() {
  const runs = Route.useLoaderData()

  return (
    <main className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Runs</h1>

      {runs.length === 0 ? (
        <div className="mt-8 rounded-[10px] border border-dashed border-neutral-300 bg-white px-8 py-12 text-center">
          <p className="font-medium">No runs yet</p>
          <p className="mt-2 text-neutral-500">
            Generate one from the repository root, then reload this page:
          </p>
          <code className="mt-4 inline-block rounded-md bg-neutral-100 px-3 py-2 font-mono text-xs">
            uv run vitroflow tests/fixtures/images -o data/runs/&lt;run-name&gt;
          </code>
        </div>
      ) : (
        <div className="mt-8 overflow-hidden rounded-[10px] border border-neutral-200 bg-white">
          <div
            className={`${COLUMNS} border-b border-neutral-200 py-2.5 text-[11px] tracking-wider text-neutral-400 uppercase`}
          >
            <span>Run</span>
            <span className="text-right">Images</span>
            <span className="text-right">Total</span>
            <span className="text-right">Flagged</span>
          </div>
          <ul className="divide-y divide-neutral-100">
            {runs.map((run) => (
              <li key={run.runId}>
                <Link
                  to="/runs/$runId"
                  params={{ runId: run.runId }}
                  className={`${COLUMNS} py-3 hover:bg-neutral-50`}
                >
                  <span className="truncate font-mono font-medium">{run.runId}</span>
                  <span className="text-right font-mono tabular-nums text-neutral-500">
                    {run.imageCount}
                  </span>
                  <CountCell count={run.totalCount} delta={run.delta} />
                  {run.flaggedCount > 0 ? (
                    <span className="text-right font-mono tabular-nums text-amber-600">
                      {run.flaggedCount}
                    </span>
                  ) : (
                    <span className="text-right text-neutral-300">—</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  )
}

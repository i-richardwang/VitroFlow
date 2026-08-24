import { Link, createFileRoute } from '@tanstack/react-router'

import { ImageViewer } from '../components/ImageViewer'
import { QualityWarnings } from '../components/QualityWarnings'
import { getImageResult } from '../server/runs'

export const Route = createFileRoute('/runs/$runId/$stem')({
  loader: ({ params }) => getImageResult({ data: { runId: params.runId, stem: params.stem } }),
  component: ImagePage,
})

function ImagePage() {
  const { runId, stem } = Route.useParams()
  const result = Route.useLoaderData()

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
        <span className="font-mono tabular-nums text-neutral-500">{result.count} seeds</span>
        <QualityWarnings quality={result.quality} />
      </div>
      <ImageViewer runId={runId} stem={stem} result={result} />
    </div>
  )
}

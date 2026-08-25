import { createFileRoute } from '@tanstack/react-router'

import { ImageReview } from '../components/ImageReview'
import { getImage } from '../server/runs'

export const Route = createFileRoute('/runs/$runId/$stem')({
  loader: ({ params }) => getImage({ data: { runId: params.runId, stem: params.stem } }),
  component: ImagePage,
})

function ImagePage() {
  const { runId, stem } = Route.useParams()
  const { result, corrections } = Route.useLoaderData()

  return (
    <ImageReview
      key={`${runId}/${stem}`}
      runId={runId}
      stem={stem}
      result={result}
      corrections={corrections}
    />
  )
}

import { createFileRoute } from "@tanstack/react-router";

import { ImageWorkbench } from "../components/workbench/ImageWorkbench";
import { getImage } from "../server/runs";

export const Route = createFileRoute("/runs/$runId/$stem")({
  loader: ({ params }) =>
    getImage({ data: { runId: params.runId, stem: params.stem } }),
  component: ImagePage,
});

function ImagePage() {
  const { runId, stem } = Route.useParams();
  const { result, label } = Route.useLoaderData();

  return (
    <ImageWorkbench
      key={`${runId}/${stem}`}
      runId={runId}
      stem={stem}
      result={result}
      label={label}
    />
  );
}

import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { ImageWorkbench } from "../../components/workbench/ImageWorkbench";
import { getImage } from "../../server/images";

export const Route = createFileRoute("/_workbench/datasets/$dataset/$stem")({
  loader: ({ params }) =>
    getImage({ data: { dataset: params.dataset, stem: params.stem } }),
  // The editor owns the document while the page is open and the label file
  // is the source of truth between visits, so a cached copy is never wanted.
  gcTime: 0,
  component: ImagePage,
});

function ImagePage() {
  const image = Route.useParams();
  const { prelabel, label } = Route.useLoaderData();
  const router = useRouter();

  useEffect(() => {
    if (prelabel !== null) {
      return;
    }
    const timer = window.setInterval(() => void router.invalidate(), 5000);
    return () => window.clearInterval(timer);
  }, [prelabel, router]);

  return (
    <ImageWorkbench
      key={`${image.dataset}/${image.stem}`}
      image={image}
      prelabel={prelabel}
      label={label}
    />
  );
}

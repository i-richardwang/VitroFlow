import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { ImageWorkbench } from "../../components/workbench/ImageWorkbench";
import { getImage } from "../../server/images";

export const Route = createFileRoute("/_workbench/datasets/$dataset/$digest")({
  loader: async ({ params }) => {
    const image = await getImage({
      data: { dataset: params.dataset, digest: params.digest },
    });
    if (!image) throw notFound();
    return image;
  },
  // The editor owns the document while the page is open and the label row
  // is the source of truth between visits, so a cached copy is never wanted.
  gcTime: 0,
  component: ImagePage,
});

function ImagePage() {
  const image = Route.useParams();
  const { summary, prelabel, label } = Route.useLoaderData();
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
      key={`${image.dataset}/${image.digest}`}
      image={image}
      filename={summary.filename}
      prelabel={prelabel}
      label={label}
    />
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { Images, Upload } from "lucide-react";
import { useState } from "react";

import { ImportDatasetDialog } from "../../features/datasets/ImportDatasetDialog";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { PageHeaderSkeleton } from "../../ui/kit/PageSkeleton";
import { CardGrid, CardGridSkeleton, RowCard } from "../../ui/kit/SummaryCard";
import { Page, PageColumnSkeleton } from "../../ui/Page";
import { getDatasets } from "../../functions/datasets";
import { documentTitle } from "../../ui/documentTitle";
import { m } from "../../paraglide/messages";

export const Route = createFileRoute("/_workbench/datasets/")({
  loader: () => getDatasets(),
  staticData: { crumbs: () => [{ label: m.datasets_title() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.datasets_title()) }],
  }),
  pendingComponent: () => (
    <PageColumnSkeleton>
      <PageHeaderSkeleton description />
      <CardGridSkeleton size="small" cards={3} />
    </PageColumnSkeleton>
  ),
  component: DatasetsPage,
});

function DatasetsPage() {
  const datasets = Route.useLoaderData();
  const [importing, setImporting] = useState(false);
  const startImport = () => setImporting(true);

  return (
    <Page
      title={m.datasets_title()}
      description={m.datasets_description()}
      action={
        datasets.length > 0 ? (
          <Button icon={Upload} onClick={startImport}>
            {m.dataset_import()}
          </Button>
        ) : null
      }
    >
      {datasets.length === 0 ? (
        <Empty
          icon={Images}
          title={m.datasets_empty()}
          description={m.datasets_empty_description()}
          action={
            <>
              <Button type="primary" icon={Upload} onClick={startImport}>
                {m.dataset_import()}
              </Button>
              <Button render={<Link to="/experiments" />}>
                {m.dataset_open_experiments()}
              </Button>
            </>
          }
        />
      ) : (
        <CardGrid aria-label={m.datasets_title()} size="small">
          {datasets.map((dataset) => (
            <RowCard
              key={dataset.dataset}
              icon={Images}
              title={dataset.dataset}
              description={m.dataset_card_facts({
                model: dataset.modelId,
                images: dataset.imageCount,
                reviewed: dataset.reviewedCount,
              })}
              render={
                <Link
                  to="/datasets/$dataset"
                  params={{ dataset: dataset.dataset }}
                />
              }
            />
          ))}
        </CardGrid>
      )}
      <ImportDatasetDialog
        open={importing}
        onClose={() => setImporting(false)}
      />
    </Page>
  );
}

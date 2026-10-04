import { createFileRoute, Link } from "@tanstack/react-router";
import { Images, Upload } from "lucide-react";
import { useState } from "react";

import { formatCount } from "../../ui/numbers";
import { ImportDatasetDialog } from "../../features/datasets/ImportDatasetDialog";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { PageHeaderSkeleton, TableSkeleton } from "../../ui/kit/PageSkeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { TextLink } from "../../ui/kit/TextLink";
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
      <PageHeaderSkeleton />
      <TableSkeleton />
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
      action={
        datasets.length > 0 ? (
          <Button icon={Upload} onClick={startImport}>
            {m.dataset_import()}
          </Button>
        ) : null
      }
    >
      <Table
        aria-label={m.datasets_title()}
        narrow="cards"
        empty={
          datasets.length === 0 && (
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
          )
        }
      >
        <TableHeader>
          <tr>
            <TableHead>{m.datasets_column_dataset()}</TableHead>
            <TableHead numeric>{m.datasets_column_images()}</TableHead>
            <TableHead numeric>{m.datasets_column_reviewed()}</TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {datasets.map((dataset) => (
            <TableRow key={dataset.dataset} clickable>
              <TableCell cellSlot="title">
                <span className="flex min-w-0 flex-col">
                  <TextLink
                    className="truncate"
                    render={
                      <Link
                        to="/datasets/$dataset"
                        params={{ dataset: dataset.dataset }}
                      />
                    }
                  >
                    {dataset.dataset}
                  </TextLink>
                  <span className="truncate text-xs font-normal text-fg-secondary">
                    {dataset.modelId}
                  </span>
                </span>
              </TableCell>
              <TableCell cellLabel={m.datasets_column_images()} numeric>
                {formatCount(dataset.imageCount)}
              </TableCell>
              <TableCell cellLabel={m.datasets_column_reviewed()} numeric>
                {formatCount(dataset.reviewedCount)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ImportDatasetDialog
        open={importing}
        onClose={() => setImporting(false)}
      />
    </Page>
  );
}

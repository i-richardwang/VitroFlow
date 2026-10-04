import { createFileRoute, Link } from "@tanstack/react-router";
import { Images, Upload } from "lucide-react";
import { useState } from "react";

import { formatCount } from "../../ui/numbers";
import { ImportDatasetDialog } from "../../features/datasets/ImportDatasetDialog";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import {
  PageHeaderSkeleton,
  PageSkeleton,
  TableSkeleton,
} from "../../ui/kit/PageSkeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { TextLink } from "../../ui/kit/TextLink";
import { Absent } from "../../ui/Absent";
import { Page } from "../../ui/Page";
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
    <PageSkeleton>
      <PageHeaderSkeleton action />
      <TableSkeleton />
    </PageSkeleton>
  ),
  component: DatasetsPage,
});

function DatasetsPage() {
  const datasets = Route.useLoaderData();
  const [importing, setImporting] = useState(false);

  return (
    <Page
      title={m.datasets_title()}
      actions={
        <Button icon={Upload} onClick={() => setImporting(true)}>
          {m.dataset_import()}
        </Button>
      }
    >
      <Table aria-label={m.datasets_title()} narrow="cards">
        <TableHeader>
          <tr>
            <TableHead>{m.datasets_column_dataset()}</TableHead>
            <TableHead>{m.datasets_column_model()}</TableHead>
            <TableHead className="text-end">
              {m.datasets_column_images()}
            </TableHead>
            <TableHead className="text-end">
              {m.datasets_column_reviewed()}
            </TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {datasets.length ? (
            datasets.map((dataset) => (
              <TableRow key={dataset.dataset} clickable>
                <TableCell cellSlot="title">
                  <TextLink
                    className="font-mono"
                    render={
                      <Link
                        to="/datasets/$dataset"
                        params={{ dataset: dataset.dataset }}
                      />
                    }
                  >
                    {dataset.dataset}
                  </TextLink>
                </TableCell>
                <TableCell
                  cellLabel={m.datasets_column_model()}
                  className="font-mono text-fg-secondary"
                >
                  {dataset.modelId}
                </TableCell>
                <TableCell
                  cellLabel={m.datasets_column_images()}
                  className="text-end tabular-nums"
                >
                  {formatCount(dataset.imageCount)}
                </TableCell>
                <TableCell
                  cellLabel={m.datasets_column_reviewed()}
                  className="text-end tabular-nums"
                >
                  {dataset.reviewedCount === null ? (
                    <Absent />
                  ) : (
                    formatCount(dataset.reviewedCount)
                  )}
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmpty>
              <Empty
                icon={Images}
                title={m.datasets_empty()}
                description={m.datasets_empty_description()}
                action={
                  <>
                    <Button render={<Link to="/experiments" />}>
                      {m.dataset_open_experiments()}
                    </Button>
                    <Button icon={Upload} onClick={() => setImporting(true)}>
                      {m.dataset_import()}
                    </Button>
                  </>
                }
              />
            </TableEmpty>
          )}
        </TableBody>
      </Table>
      <ImportDatasetDialog
        open={importing}
        onClose={() => setImporting(false)}
      />
    </Page>
  );
}

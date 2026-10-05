import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChartLine, Images, Network, Upload } from "lucide-react";
import { useState } from "react";

import { ImportDatasetDialog } from "../../features/datasets/ImportDatasetDialog";
import { ModelMenu } from "../../features/models/ModelMenu";
import { modelRecordsSummary } from "../../features/models/records";
import { VersionsTable } from "../../features/models/VersionsTable";
import { TrainingRunsTable } from "../../features/training/TrainingRunsTable";
import { getModelOverview } from "../../functions/models";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { PageHeaderSkeleton, TableSkeleton } from "../../ui/kit/PageSkeleton";
import { CardGrid, RowCard } from "../../ui/kit/SummaryCard";
import { className, modelName } from "../../ui/model-names";
import {
  Page,
  PageColumnSkeleton,
  PageSection,
  PageSectionSkeleton,
} from "../../ui/Page";

type ModelOverview = NonNullable<Awaited<ReturnType<typeof getModelOverview>>>;

export const Route = createFileRoute("/_workbench/models/$model")({
  loader: async ({ params }) => {
    const overview = await getModelOverview({ data: { model: params.model } });
    if (!overview) throw notFound();
    return overview;
  },
  staticData: {
    crumbs: ({ loaderData }) => [
      { label: m.models_title(), href: "/models" },
      { label: modelName((loaderData as ModelOverview).model) },
    ],
  },
  head: ({ loaderData }) => ({
    meta: [{ title: documentTitle(loaderData && modelName(loaderData.model)) }],
  }),
  pendingComponent: () => (
    <PageColumnSkeleton>
      <PageHeaderSkeleton variant="subject" meta />
      <PageSectionSkeleton>
        <TableSkeleton rows={2} />
      </PageSectionSkeleton>
      <PageSectionSkeleton>
        <TableSkeleton rows={2} />
      </PageSectionSkeleton>
    </PageColumnSkeleton>
  ),
  component: ModelPage,
});

/**
 * One model, for whoever keeps it accurate: what it counts, the versions
 * that have read for it and how well each scored, the training sets that
 * train it, and their runs.
 */
function ModelPage() {
  const { model, records, versions, datasets, runs } = Route.useLoaderData();
  const [importing, setImporting] = useState(false);

  useRouteRefresh(10_000);

  return (
    <Page
      title={modelName(model)}
      subject
      icon={Network}
      meta={[model.id, model.classes.map(className).join(" · ")]}
      action={
        <ModelMenu model={model} deletable={!modelRecordsSummary(records)} />
      }
    >
      <PageSection title={m.versions_table()}>
        <VersionsTable
          versions={versions}
          empty={
            <Empty
              icon={Network}
              title={m.versions_empty()}
              description={m.versions_empty_description()}
            />
          }
        />
      </PageSection>

      <PageSection
        title={m.model_datasets()}
        extra={
          <Button size="small" icon={Upload} onClick={() => setImporting(true)}>
            {m.dataset_import()}
          </Button>
        }
      >
        {datasets.length === 0 ? (
          <Empty
            icon={Images}
            title={m.datasets_empty()}
            description={m.datasets_empty_description()}
            action={
              <Button render={<Link to="/experiments" />}>
                {m.dataset_open_experiments()}
              </Button>
            }
          />
        ) : (
          <CardGrid aria-label={m.model_datasets()} size="small">
            {datasets.map((dataset) => (
              <RowCard
                key={dataset.dataset}
                icon={Images}
                title={dataset.dataset}
                description={m.dataset_card_facts({
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
      </PageSection>

      <PageSection title={m.run_table_label()}>
        <TrainingRunsTable
          runs={runs}
          datasetColumn
          empty={
            <Empty
              icon={ChartLine}
              title={m.run_empty_title()}
              description={m.run_empty_description()}
            />
          }
        />
      </PageSection>

      <ImportDatasetDialog
        open={importing}
        onClose={() => setImporting(false)}
      />
    </Page>
  );
}

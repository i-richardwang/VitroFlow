import { createFileRoute } from "@tanstack/react-router";
import { Network, Plus } from "lucide-react";
import { useState } from "react";

import { ModelDialog } from "../../features/models/ModelDialog";
import { ModelMenu } from "../../features/models/ModelMenu";
import { modelRecordsSummary } from "../../features/models/records";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { Flexbox } from "../../ui/kit/Flex";
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
import { Tag } from "../../ui/kit/Tag";
import { Page } from "../../ui/Page";
import { className, modelName } from "../../ui/model-names";
import { getModelCatalogue } from "../../functions/models";
import { documentTitle } from "../../ui/documentTitle";
import { m } from "../../paraglide/messages";

export const Route = createFileRoute("/_workbench/models/")({
  loader: () => getModelCatalogue(),
  staticData: { crumbs: () => [{ label: m.models_title() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.models_title()) }],
  }),
  pendingComponent: () => (
    <PageSkeleton>
      <PageHeaderSkeleton action />
      <TableSkeleton />
    </PageSkeleton>
  ),
  component: ModelsPage,
});

function ModelsPage() {
  const entries = Route.useLoaderData();
  const [creating, setCreating] = useState(false);

  return (
    <Page
      title={m.models_title()}
      actions={
        <Button type="primary" icon={Plus} onClick={() => setCreating(true)}>
          {m.model_new()}
        </Button>
      }
    >
      <Table aria-label={m.models_title()} narrow="cards">
        <TableHeader>
          <tr>
            <TableHead>{m.models_column_model()}</TableHead>
            <TableHead>{m.model_id_label()}</TableHead>
            <TableHead>{m.models_column_classes()}</TableHead>
            <TableHead>{m.models_column_records()}</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">{m.models_column_actions()}</span>
            </TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {entries.length ? (
            entries.map((entry) => {
              const held = modelRecordsSummary(entry.records);
              return (
                <TableRow key={entry.model.id}>
                  <TableCell cellSlot="title">
                    {modelName(entry.model)}
                  </TableCell>
                  <TableCell
                    cellLabel={m.model_id_label()}
                    className="font-mono text-fg-secondary"
                  >
                    {entry.model.id}
                  </TableCell>
                  <TableCell cellLabel={m.models_column_classes()}>
                    <Flexbox horizontal gap={4} wrap="wrap">
                      {entry.model.classes.map((each) => (
                        <Tag key={each}>{className(each)}</Tag>
                      ))}
                    </Flexbox>
                  </TableCell>
                  <TableCell
                    cellLabel={m.models_column_records()}
                    className="text-fg-tertiary"
                  >
                    {held ?? m.model_records_none()}
                  </TableCell>
                  <TableCell cellSlot="extra" className="text-end">
                    <ModelMenu model={entry.model} deletable={!held} />
                  </TableCell>
                </TableRow>
              );
            })
          ) : (
            <TableEmpty>
              <Empty
                icon={Network}
                title={m.models_empty()}
                description={m.models_empty_description()}
                action={
                  <Button icon={Plus} onClick={() => setCreating(true)}>
                    {m.model_new()}
                  </Button>
                }
              />
            </TableEmpty>
          )}
        </TableBody>
      </Table>
      <ModelDialog open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}

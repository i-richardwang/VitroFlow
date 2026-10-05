import { createFileRoute } from "@tanstack/react-router";
import { Network, Plus } from "lucide-react";
import { useState } from "react";

import { ModelDialog } from "../../features/models/ModelDialog";
import { ModelMenu } from "../../features/models/ModelMenu";
import { modelRecordsSummary } from "../../features/models/records";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { Item, ItemList, ItemListSkeleton } from "../../ui/kit/ItemList";
import { Tag } from "../../ui/kit/Tag";
import { Page, PageColumnSkeleton } from "../../ui/Page";
import { className, modelName } from "../../ui/model-names";
import { getModelCatalogue } from "../../functions/models";
import { documentTitle } from "../../ui/documentTitle";
import { PageHeaderSkeleton } from "../../ui/kit/PageSkeleton";
import { m } from "../../paraglide/messages";

export const Route = createFileRoute("/_workbench/models/")({
  loader: () => getModelCatalogue(),
  staticData: { crumbs: () => [{ label: m.models_title() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.models_title()) }],
  }),
  pendingComponent: () => (
    <PageColumnSkeleton>
      <PageHeaderSkeleton description />
      <ItemListSkeleton icon />
    </PageColumnSkeleton>
  ),
  component: ModelsPage,
});

function ModelsPage() {
  const entries = Route.useLoaderData();
  const [creating, setCreating] = useState(false);
  const create = () => setCreating(true);

  return (
    <Page
      title={m.models_title()}
      description={m.models_description()}
      action={
        entries.length > 0 ? (
          <Button type="primary" icon={Plus} onClick={create}>
            {m.model_new()}
          </Button>
        ) : null
      }
    >
      <ItemList
        aria-label={m.models_title()}
        empty={
          entries.length === 0 && (
            <Empty
              icon={Network}
              title={m.models_empty()}
              description={m.models_empty_description()}
              action={
                <Button type="primary" icon={Plus} onClick={create}>
                  {m.model_new()}
                </Button>
              }
            />
          )
        }
      >
        {entries.map((entry) => {
          const held = modelRecordsSummary(entry.records);
          return (
            <Item
              key={entry.model.id}
              icon={Network}
              title={modelName(entry.model)}
              addon={<Tag size="small">{entry.model.id}</Tag>}
              extra={entry.model.classes.map((each) => (
                <Tag key={each}>{className(each)}</Tag>
              ))}
              meta={held ?? m.model_records_none()}
              actions={<ModelMenu model={entry.model} deletable={!held} />}
            />
          );
        })}
      </ItemList>
      <ModelDialog open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}

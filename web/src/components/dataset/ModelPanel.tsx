import { Widget } from "@heroui-pro/react/widget";
import { Tabs } from "@heroui/react";

import type { DatasetOverview } from "../../server/overview";
import { TrainDialog } from "./TrainDialog";
import { TrainingRunsTable } from "./TrainingRunsTable";
import { VersionsTable } from "./VersionsTable";

/** Candidate versions of the dataset's model and the runs that produced them. */
export function ModelPanel({ overview }: { overview: DatasetOverview }) {
  const { dataset, counts, versions, training } = overview;

  return (
    <Widget>
      <Widget.Header className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Widget.Title>Model</Widget.Title>
          <Widget.Description>
            Every version is a candidate; prelabelling only follows the selected
            one, and a new version never replaces it on its own.
          </Widget.Description>
        </div>
        <TrainDialog dataset={dataset.id} complete={counts.complete} training={training} />
      </Widget.Header>
      <Widget.Content>
        <Tabs variant="secondary">
          <Tabs.ListContainer>
            <Tabs.List aria-label="Model">
              <Tabs.Tab id="versions">
                Versions
                <TabCount value={versions.length} />
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="runs">
                Training runs
                <TabCount value={training.runs.length} />
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
          <Tabs.Panel id="versions" className="pt-4">
            <VersionsTable dataset={dataset.id} versions={versions} />
          </Tabs.Panel>
          <Tabs.Panel id="runs" className="pt-4">
            <TrainingRunsTable runs={training.runs} complete={counts.complete} />
          </Tabs.Panel>
        </Tabs>
      </Widget.Content>
    </Widget>
  );
}

function TabCount({ value }: { value: number }) {
  return (
    <span className="ml-1.5 font-mono tabular-nums text-muted">{value}</span>
  );
}

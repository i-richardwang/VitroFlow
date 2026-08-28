import { Chip, Table } from "@heroui/react";

import { validationMetric, versionSlug } from "../../models/schema";
import type { VersionOverview } from "../../server/overview";
import { Count } from "../Count";
import { Metric } from "../training/Metric";
import { ModelKindChip } from "./ModelKindChip";
import { SelectVersionDialog } from "./SelectVersionDialog";

export function VersionsTable({
  dataset,
  versions,
}: {
  dataset: string;
  versions: VersionOverview[];
}) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="Model versions">
          <Table.Header>
            <Table.Column isRowHeader>Version</Table.Column>
            <Table.Column>Kind</Table.Column>
            <Table.Column className="whitespace-nowrap text-right">
              Trained on
            </Table.Column>
            <Table.Column className="text-right">mAP50</Table.Column>
            <Table.Column className="whitespace-nowrap text-right">
              mAP50-95
            </Table.Column>
            <Table.Column>
              <span className="sr-only">Selection</span>
            </Table.Column>
          </Table.Header>
          <Table.Body>
            {versions.map(({ version, selected, trainingImages }) => (
              <Table.Row key={version.id}>
                <Table.Cell className="font-mono font-medium">
                  {versionSlug(version)}
                </Table.Cell>
                <Table.Cell>
                  <ModelKindChip kind={version.artifact.kind} />
                </Table.Cell>
                <Table.Cell className="text-right font-mono tabular-nums">
                  <Count value={trainingImages} />
                </Table.Cell>
                <Table.Cell className="text-right font-mono tabular-nums">
                  <Metric value={validationMetric(version.artifact, "mAP50")} />
                </Table.Cell>
                <Table.Cell className="text-right font-mono tabular-nums">
                  <Metric
                    value={validationMetric(version.artifact, "mAP50-95")}
                  />
                </Table.Cell>
                <Table.Cell className="text-right">
                  {selected ? (
                    <Chip color="accent" variant="soft" size="sm">
                      Selected
                    </Chip>
                  ) : (
                    <SelectVersionDialog
                      dataset={dataset}
                      versionId={version.id}
                      label={versionSlug(version)}
                    />
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

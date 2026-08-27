import { Chip, Table } from "@heroui/react";

import { validationMetric, versionSlug } from "../../models/schema";
import type { VersionOverview } from "../../server/overview";
import { Count } from "../Count";
import { Timestamp } from "../Timestamp";
import { ModelKindChip } from "./ModelKindChip";
import { SelectVersionDialog } from "./SelectVersionDialog";
import { ServingChip } from "./ServingChip";

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
            <Table.Column>Serving</Table.Column>
            <Table.Column>
              <span className="sr-only">Selection</span>
            </Table.Column>
          </Table.Header>
          <Table.Body>
            {versions.map(({ version, selected, serving, trainingImages }) => (
              <Table.Row key={version.id}>
                <Table.Cell className="font-mono font-medium">
                  {versionSlug(version)}
                  <span className="mt-1 block font-sans text-xs font-normal text-muted">
                    {version.name} · <Timestamp value={version.createdAt} />
                  </span>
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
                <Table.Cell>
                  <ServingChip serving={serving} />
                </Table.Cell>
                <Table.Cell className="text-right">
                  {selected ? (
                    <Chip color="accent" variant="primary" size="sm">
                      Selected
                    </Chip>
                  ) : (
                    <SelectVersionDialog
                      dataset={dataset}
                      versionId={version.id}
                      label={versionSlug(version)}
                      serving={serving}
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

function Metric({ value }: { value: number | null }) {
  return value === null ? (
    <span className="text-muted">—</span>
  ) : (
    <>{value.toFixed(3)}</>
  );
}

import { EmptyState } from "@heroui-pro/react/empty-state";
import { Table } from "@heroui/react";

import { validationMetric, versionSlug } from "../../models/schema";
import type { VersionOverview } from "../../server/training-console";
import { Count } from "../Count";
import { EmptyStateHeading } from "../EmptyStateHeading";
import { Metric } from "../training/Metric";
import { Timestamp } from "../Timestamp";
import { ModelKindChip } from "./ModelKindChip";

/** Every version of every model, newest first; an experiment picks from these. */
export function VersionsTable({ versions }: { versions: VersionOverview[] }) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="Model versions">
          <Table.Header>
            <Table.Column isRowHeader>Version</Table.Column>
            <Table.Column>Model</Table.Column>
            <Table.Column>Kind</Table.Column>
            <Table.Column>Published</Table.Column>
            <Table.Column className="whitespace-nowrap text-right">
              Trained on
            </Table.Column>
            <Table.Column className="text-right">mAP50</Table.Column>
            <Table.Column className="whitespace-nowrap text-right">
              mAP50-95
            </Table.Column>
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <EmptyState size="sm">
                <EmptyState.Header>
                  <EmptyStateHeading>No versions</EmptyStateHeading>
                </EmptyState.Header>
              </EmptyState>
            )}
          >
            {versions.map(({ version, trainingImages }) => (
              <Table.Row key={version.id}>
                <Table.Cell className="font-mono font-medium">
                  {versionSlug(version)}
                </Table.Cell>
                <Table.Cell className="font-mono text-muted">
                  {version.modelId}
                </Table.Cell>
                <Table.Cell>
                  <ModelKindChip kind={version.artifact.kind} />
                </Table.Cell>
                <Table.Cell className="text-muted">
                  <Timestamp value={version.createdAt} />
                </Table.Cell>
                <Table.Cell className="text-right font-mono tabular-nums">
                  <Count value={trainingImages} />
                </Table.Cell>
                <Table.Cell className="text-right font-mono tabular-nums">
                  <Metric value={validationMetric(version.artifact, "map50")} />
                </Table.Cell>
                <Table.Cell className="text-right font-mono tabular-nums">
                  <Metric
                    value={validationMetric(version.artifact, "map50_95")}
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

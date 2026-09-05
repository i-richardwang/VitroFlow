import { EmptyState } from "@heroui-pro/react/empty-state";
import { Table } from "@heroui/react";

import { validationMetric, versionSlug } from "../../models/schema";
import type { VersionOverview } from "../../training/read-model";
import { m } from "../../paraglide/messages";
import { Count } from "../Count";
import { Metric } from "../training/Metric";
import { Timestamp } from "../Timestamp";
import { ModelKindChip } from "./ModelKindChip";

export function VersionsTable({ versions }: { versions: VersionOverview[] }) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={m.versions_table()}>
          <Table.Header>
            <Table.Column isRowHeader>
              {m.versions_column_version()}
            </Table.Column>
            <Table.Column>{m.versions_column_model()}</Table.Column>
            <Table.Column>{m.versions_column_kind()}</Table.Column>
            <Table.Column>{m.versions_column_published()}</Table.Column>
            <Table.Column className="whitespace-nowrap text-right">
              {m.versions_column_trained_on()}
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
                  <EmptyState.Title>{m.versions_empty()}</EmptyState.Title>
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
                    value={validationMetric(version.artifact, "map50To95")}
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

import { Chip } from "@heroui/react";

import type { WorkerCount } from "../../server/overview";

function workers(count: number): string {
  return `${count} ${count === 1 ? "worker" : "workers"}`;
}

/** Whether any inference worker can currently prelabel with a version. */
export function ServingChip({ serving }: { serving: WorkerCount }) {
  if (serving.online > 0) {
    return (
      <Chip color="success" variant="soft" size="sm">
        Served by {workers(serving.online)}
      </Chip>
    );
  }
  return (
    <Chip color="warning" variant="soft" size="sm">
      {serving.stale > 0 ? `${workers(serving.stale)} stale` : "No worker serving"}
    </Chip>
  );
}

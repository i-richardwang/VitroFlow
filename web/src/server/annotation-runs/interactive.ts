import { and, eq, inArray } from "drizzle-orm";

import { database, transaction } from "../infra/db/client";
import { annotationRuns, workspaceSettings } from "../infra/db/schema";

/**
 * Whether agents people connect over MCP may annotate. It is on until an
 * administrator turns it off.
 */
export async function interactiveAnnotationEnabled(): Promise<boolean> {
  const [row] = await (
    await database()
  )
    .select({ enabled: workspaceSettings.interactiveAnnotation })
    .from(workspaceSettings);
  return row?.enabled ?? true;
}

/** Turning it off also ends the runs connected agents hold open. */
export async function setInteractiveAnnotation(
  enabled: boolean,
): Promise<void> {
  await transaction(async (tx) => {
    await tx
      .insert(workspaceSettings)
      .values({ interactiveAnnotation: enabled })
      .onConflictDoUpdate({
        target: workspaceSettings.id,
        set: { interactiveAnnotation: enabled },
      });
    if (enabled) return;
    await tx
      .update(annotationRuns)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(annotationRuns.executor, "interactive"),
          inArray(annotationRuns.status, ["queued", "running"]),
        ),
      );
  });
}

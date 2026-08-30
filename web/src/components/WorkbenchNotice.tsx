import { EmptyState } from "@heroui-pro/react/empty-state";
import { Link } from "@heroui/react";

/** Full-area empty state with a way back to the experiments list. */
export function WorkbenchNotice({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>{title}</EmptyState.Title>
          <EmptyState.Description>{description}</EmptyState.Description>
        </EmptyState.Header>
        <EmptyState.Content>
          <Link href="/experiments" className="text-sm font-medium">
            Return to experiments
          </Link>
        </EmptyState.Content>
      </EmptyState>
    </div>
  );
}

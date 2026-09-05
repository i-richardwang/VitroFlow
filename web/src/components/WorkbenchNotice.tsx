import { EmptyState } from "@heroui-pro/react/empty-state";
import { Link } from "@heroui/react";

import { m } from "../paraglide/messages";

export function WorkbenchNotice({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>{title}</EmptyState.Title>
          {description ? (
            <EmptyState.Description>{description}</EmptyState.Description>
          ) : null}
        </EmptyState.Header>
        <EmptyState.Content>
          <Link href="/experiments" className="text-sm font-medium">
            {m.return_to_experiments()}
          </Link>
        </EmptyState.Content>
      </EmptyState>
    </div>
  );
}

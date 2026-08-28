import { Card } from "@heroui/react";

export function StatKpi({ label, value }: { label: string; value: number }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-sm font-medium text-foreground/80">{label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </span>
    </Card>
  );
}

import { formatDelta } from '../format'

export function CountCell({ count, delta }: { count: number; delta: number }) {
  return (
    <span className="flex items-baseline justify-end font-mono tabular-nums">
      {count}
      <span className="w-8 pl-1.5 text-neutral-400">{delta === 0 ? '' : formatDelta(delta)}</span>
    </span>
  )
}

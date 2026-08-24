import type { CalibrationEdit, SeedResult } from '../schemas'

export function DetectionsTable({
  detections,
  edit,
}: {
  detections: SeedResult['detections']
  edit: CalibrationEdit
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <h2 className="px-5 pt-4 pb-2 text-[11px] font-medium tracking-wider text-neutral-400 uppercase">
        Detections
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white">
            <tr className="text-left text-neutral-400">
              <th className="py-1.5 font-medium">#</th>
              <th className="py-1.5 text-right font-medium">x</th>
              <th className="py-1.5 text-right font-medium">y</th>
              <th className="py-1.5 text-right font-medium">score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 font-mono tabular-nums">
            {detections.map((detection) => (
              <tr
                key={detection.id}
                className={edit.removed.includes(detection.id) ? 'text-neutral-300 line-through' : ''}
              >
                <td className="py-1.5 text-neutral-400">{detection.id}</td>
                <td className="py-1.5 text-right">{detection.x.toFixed(0)}</td>
                <td className="py-1.5 text-right">{detection.y.toFixed(0)}</td>
                <td className="py-1.5 text-right">{detection.score.toFixed(2)}</td>
              </tr>
            ))}
            {edit.added.map((point) => (
              <tr key={`${point.x}:${point.y}`}>
                <td className="py-1.5 text-neutral-400">+</td>
                <td className="py-1.5 text-right">{point.x.toFixed(0)}</td>
                <td className="py-1.5 text-right">{point.y.toFixed(0)}</td>
                <td className="py-1.5 text-right text-neutral-300">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

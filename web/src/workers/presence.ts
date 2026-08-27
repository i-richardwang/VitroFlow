const WORKER_PRESENCES = ["online", "stale", "offline"] as const;

export type WorkerPresence = (typeof WORKER_PRESENCES)[number];

export const WORKER_ONLINE_SECONDS = 30;
export const WORKER_STALE_SECONDS = 90;
export const WORKER_FORGET_SECONDS = 7 * 24 * 60 * 60;

function secondsSince(timestamp: string, at: Date): number {
  return (at.getTime() - Date.parse(timestamp)) / 1000;
}

export function workerPresence(
  lastSeenAt: string,
  at: Date = new Date(),
): WorkerPresence {
  const age = secondsSince(lastSeenAt, at);
  if (age <= WORKER_ONLINE_SECONDS) return "online";
  return age <= WORKER_STALE_SECONDS ? "stale" : "offline";
}

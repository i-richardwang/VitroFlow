/** FIFO admission; a completed or failed operation releases its slot. */
export function createWorkGate(limit: number) {
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError("Work concurrency must be a positive integer");
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(work: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      if (active < limit) {
        active++;
        resolve();
      } else waiting.push(resolve);
    });
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/** Share work in progress, without retaining results or failed promises. */
export function createSingleFlight<T>() {
  const pending = new Map<string, Promise<T>>();
  return function run(key: string, work: () => Promise<T>): Promise<T> {
    const existing = pending.get(key);
    if (existing) return existing;
    const result = Promise.resolve()
      .then(work)
      .finally(() => pending.delete(key));
    pending.set(key, result);
    return result;
  };
}

import { useSyncExternalStore } from "react";

/** The value never changes after it is read; there is nothing to subscribe to. */
const subscribeNothing = () => () => {};

/**
 * A value only the browser can read, constant for the session. The server and
 * the first client frame use `serverValue`, so hydration matches; `read`
 * supplies the real value in the render after.
 */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(subscribeNothing, read, () => serverValue);
}

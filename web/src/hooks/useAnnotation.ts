import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AnnotationDocument,
  LabelRef,
  SeedInstance,
} from "../annotation/schema";
import { transition, type ReviewEvent } from "../annotation/status";
import { saveLabel } from "../functions/review";

export type SaveState = "saved" | "saving" | "failed";

interface AnnotationState {
  annotation: AnnotationDocument;
  saveState: SaveState;
  error: string | null;
  setInstances: (instances: SeedInstance[]) => void;
  review: (event: ReviewEvent) => void;
  retry: () => void;
}

const RETRY_DELAYS_MS = [500, 2000, 5000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Owns the review document for one image and model and persists every change.
 *
 * Saves run through a single serial queue: each save carries the last
 * acknowledged revision, and edits made while one is in flight are flushed
 * in a single follow-up save. A failed save is retried with backoff before
 * it is reported. While anything is unsaved, in-app navigation waits for the
 * queue and page unload asks for confirmation.
 */
export function useAnnotation(
  subject: LabelRef,
  initial: AnnotationDocument,
): AnnotationState {
  const [annotation, setAnnotation] = useState(initial);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);

  const latest = useRef(initial);
  const acknowledgedRevision = useRef(initial.revision);
  const unsaved = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const save = useCallback(async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const saved = await saveLabel({
          data: {
            ref: subject,
            document: {
              ...latest.current,
              revision: acknowledgedRevision.current,
            },
          },
        });
        acknowledgedRevision.current = saved.revision;
        latest.current = { ...latest.current, revision: saved.revision };
        setAnnotation(latest.current);
        return true;
      } catch (cause) {
        if (attempt === RETRY_DELAYS_MS.length) {
          setError(cause instanceof Error ? cause.message : String(cause));
          return false;
        }
        await delay(RETRY_DELAYS_MS[attempt]);
      }
    }
  }, [subject]);

  const flush = useCallback(() => {
    setSaveState("saving");
    queue.current = queue.current.then(async () => {
      if (!unsaved.current) {
        return;
      }
      unsaved.current = false;
      if (await save()) {
        setError(null);
        setSaveState((state) => (unsaved.current ? state : "saved"));
      } else {
        unsaved.current = true;
        setSaveState("failed");
      }
    });
  }, [save]);

  const commit = useCallback(
    (next: AnnotationDocument) => {
      latest.current = next;
      unsaved.current = true;
      setAnnotation(next);
      flush();
    },
    [flush],
  );

  useBlocker({
    shouldBlockFn: async () => {
      await queue.current;
      return unsaved.current;
    },
  });

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (unsaved.current) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  return {
    annotation,
    saveState,
    error,
    setInstances: (instances) =>
      commit(transition({ ...latest.current, instances }, { type: "edit" })),
    review: (event) => commit(transition(latest.current, event)),
    retry: flush,
  };
}

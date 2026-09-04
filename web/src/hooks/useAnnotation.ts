import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AnnotationDocument,
  AnnotationRef,
  AnnotationInstance,
} from "../annotation/schema";
import { editReview, finishReview } from "../annotation/status";
import { saveReview } from "../functions/review";

export type SaveState = "saved" | "saving" | "failed";

interface AnnotationState {
  annotation: AnnotationDocument;
  saveState: SaveState;
  error: string | null;
  setInstances: (instances: AnnotationInstance[]) => void;
  /** Marks the review complete and resolves once it is stored, or false if not. */
  finish: () => Promise<boolean>;
  retry: () => void;
}

/** A save that fails is tried again after each of these before it is reported. */
const RETRY_DELAYS_MS = [500, 2000, 5000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Owns the review document for one image and model and persists every change.
 *
 * One save loop runs at a time: it stores the latest document, and goes round
 * again if an edit arrived meanwhile, so edits made during a save reach the
 * server in one follow-up. The document always carries the revision the
 * server last acknowledged, which is how a stale edit is refused. A failed
 * save leaves the loop stopped with the edit still pending until it is
 * retried. While anything is pending, in-app navigation waits for the loop
 * and page unload asks for confirmation.
 *
 * Changing the boxes puts the review in progress; finishing marks it complete
 * once the last edit has been stored.
 */
export function useAnnotation(
  subject: AnnotationRef,
  opened: AnnotationDocument,
): AnnotationState {
  const [annotation, setAnnotation] = useState(opened);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);

  const latest = useRef(opened);
  const pending = useRef(false);
  const loop = useRef<Promise<void> | null>(null);

  const save = useCallback(async (): Promise<boolean> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const saved = await saveReview({
          data: { ref: subject, document: latest.current },
        });
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
    if (loop.current) return;
    setSaveState("saving");
    loop.current = (async () => {
      while (pending.current) {
        pending.current = false;
        if (!(await save())) {
          pending.current = true;
          setSaveState("failed");
          break;
        }
      }
      loop.current = null;
      if (!pending.current) {
        setError(null);
        setSaveState("saved");
      }
    })();
  }, [save]);

  const commit = useCallback(
    (next: AnnotationDocument) => {
      latest.current = next;
      pending.current = true;
      setAnnotation(next);
      flush();
    },
    [flush],
  );

  const finish = useCallback(async () => {
    if (latest.current.status !== "complete") {
      commit(finishReview(latest.current));
    }
    await loop.current;
    return !pending.current;
  }, [commit]);

  useBlocker({
    shouldBlockFn: async () => {
      await loop.current;
      return pending.current;
    },
  });

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (pending.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  return {
    annotation,
    saveState,
    error,
    setInstances: (instances) => commit(editReview(latest.current, instances)),
    finish,
    retry: flush,
  };
}

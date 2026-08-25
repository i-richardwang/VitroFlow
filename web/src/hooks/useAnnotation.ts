import { useCallback, useEffect, useRef, useState } from "react";

import type { AnnotationDocument, SeedInstance } from "../annotation/schema";
import { transition, type ReviewEvent } from "../annotation/status";
import { saveLabel } from "../server/runs";

export type SaveState = "saved" | "pending" | "saving" | "failed";

interface AnnotationState {
  annotation: AnnotationDocument;
  saveState: SaveState;
  error: string | null;
  setInstances: (instances: SeedInstance[]) => void;
  review: (event: ReviewEvent) => void;
  retry: () => void;
}

/**
 * Owns the annotation document for one image. Every change is written
 * through a single serial save queue: a save carries the last acknowledged
 * revision, and further edits made while it is in flight are flushed in one
 * follow-up save once it returns.
 */
export function useAnnotation(
  stem: string,
  initial: AnnotationDocument,
): AnnotationState {
  const [annotation, setAnnotation] = useState(initial);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);

  const latest = useRef(initial);
  const acknowledgedRevision = useRef(initial.revision);
  const inFlight = useRef(false);
  const dirty = useRef(false);

  const flush = useCallback(async () => {
    if (inFlight.current || !dirty.current) {
      return;
    }
    inFlight.current = true;
    dirty.current = false;
    setSaveState("saving");
    try {
      const saved = await saveLabel({
        data: {
          stem,
          document: {
            ...latest.current,
            revision: acknowledgedRevision.current,
          },
        },
      });
      acknowledgedRevision.current = saved.revision;
      latest.current = { ...latest.current, revision: saved.revision };
      setAnnotation(latest.current);
      setError(null);
      inFlight.current = false;
      if (dirty.current) {
        void flush();
      } else {
        setSaveState("saved");
      }
    } catch (cause) {
      inFlight.current = false;
      dirty.current = true;
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaveState("failed");
    }
  }, [stem]);

  const commit = useCallback(
    (next: AnnotationDocument) => {
      latest.current = next;
      dirty.current = true;
      setAnnotation(next);
      setSaveState((state) => (state === "saving" ? state : "pending"));
      void flush();
    },
    [flush],
  );

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty.current || inFlight.current) {
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
    retry: () => {
      dirty.current = true;
      void flush();
    },
  };
}

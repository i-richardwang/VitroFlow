export type AnnotationPrincipal =
  | { kind: "user"; userId: string; clientId: string }
  | {
      kind: "task";
      runId: string;
      taskId: string;
      attemptId: string;
      expiresAt: number;
    };

export interface ListedImage {
  id: number;
  file: File;
  state:
    | {
        status: "storing";
        /** The share of the file sent so far, 0 to 1. */
        progress: number;
      }
    | { status: "stored"; digest: string }
    | { status: "failed"; reason: string };
}

export interface ListedImage {
  id: number;
  file: File;
  state:
    | { status: "storing"; progress: number }
    | { status: "stored"; digest: string }
    | { status: "failed"; reason: string };
}

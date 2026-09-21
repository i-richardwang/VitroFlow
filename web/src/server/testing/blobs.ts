import { listBlobs } from "../infra/blobs/store";

export async function blobExists(key: string): Promise<boolean> {
  return (await listBlobs(key)).includes(key);
}

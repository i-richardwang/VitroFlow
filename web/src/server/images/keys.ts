export function imageBlobKey(digest: string): string {
  return `images/${digest.slice(0, 2)}/${digest}`;
}

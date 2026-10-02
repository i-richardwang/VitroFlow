export function imageBlobKey(digest: string): string {
  return `images/${digest.slice(0, 2)}/${digest}`;
}

export function imageRegionsPrefix(digest: string): string {
  return `image-regions/${digest}/`;
}

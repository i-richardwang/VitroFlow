/** Where a stored picture is served from. */
export const pictureSrc = (digest: string) => `/img/${digest}`;

/** Settles once the picture can be painted at once, or cannot be had at all. */
export function pictureReady(digest: string): Promise<void> {
  const image = new Image();
  image.src = pictureSrc(digest);
  return image.decode().catch(() => undefined);
}

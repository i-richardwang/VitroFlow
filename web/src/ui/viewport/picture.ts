/** Where a stored picture is served from. */
export const pictureSrc = (digest: string) => `/img/${digest}`;

/** Where a picture's preview is served from: the whole frame, small enough to arrive at once. */
export const previewSrc = (digest: string) => `/img/${digest}/preview`;

/**
 * Fetches what `src` names. `ready` settles once it can be painted at once,
 * with false when it cannot be had at all; `release` gives the fetch up.
 */
export function loadPicture(src: string) {
  const image = new Image();
  image.src = src;
  return {
    ready: image.decode().then(
      () => true,
      () => false,
    ),
    release() {
      image.src = "";
    },
  };
}

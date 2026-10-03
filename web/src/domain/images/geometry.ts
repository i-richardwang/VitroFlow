export interface ImageFrame {
  digest: string;
  width: number;
  height: number;
}
export interface ImageRegionLayout {
  coreSize: number;
  halo: number;
  displayScale: number;
}
export interface ImageRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ImageRegion {
  id: string;
  core: ImageRectangle;
  patch: ImageRectangle;
}

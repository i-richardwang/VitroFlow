import type { ReactNode } from "react";

import type { LayerKey } from "./controls";

/** What the page around an image adds to its workbench. */
export interface ImageWorkbenchContext {
  /** The inspector's first block, a `WorkbenchIdentity` naming the image. */
  identity?: ReactNode;
  /** Top-bar commands beside Calibrate, each a header-sized `ActionIcon`. */
  actions?: ReactNode;
  /** The top bar's `PageMenu`. */
  menu?: ReactNode;
  toolbar?: ReactNode;
  /** Inspector sections about the image's place in the page's subject. */
  details?: ReactNode;
}
export interface Display {
  layers: ReadonlySet<LayerKey>;
  onLayersChange: (layers: Set<LayerKey>) => void;
}

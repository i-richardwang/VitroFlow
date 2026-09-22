import type { ReactNode } from "react";

import type { LayerKey } from "./controls";

export interface ImageWorkbenchContext {
  actions?: ReactNode;
  menu?: ReactNode;
  toolbar?: ReactNode;
  details?: ReactNode;
}
export interface Display {
  layers: ReadonlySet<LayerKey>;
  onLayersChange: (layers: Set<LayerKey>) => void;
}

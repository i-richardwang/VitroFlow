import type { ReactNode } from "react";

/** What the page around an image adds to its workbench. */
export interface ImageWorkbenchContext {
  /** The top bar's `PageMenu`. */
  menu?: ReactNode;
  /** The `WorkbenchFooter` stepping to the images beside this one. */
  steps?: ReactNode;
  /** A lasting state of the image, such as a failed detection, as an `Alert`. */
  alert?: ReactNode;
  /**
   * The classes the page's subject counts, in the order the model declares
   * them; every class the model finds when unset.
   */
  counted?: readonly string[];
  /** Inspector sections about the image's place in the page's subject. */
  sections?: ReactNode;
  /** `DescriptionsItem`s leading the image's details. */
  facts?: ReactNode;
}

import type { ReactNode } from "react";

/*
 * The outlined surface a section's content sits on when it is not a table or
 * a grid of cards, such as a chart or a list of parameters: the container
 * color in a thin border (radius 12, as a table's card), padded 20px, its
 * content stacked 20px apart.
 */
export function Card({ children }: { children: ReactNode }) {
  return <div className="ui-card">{children}</div>;
}

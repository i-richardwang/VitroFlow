import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { ArrowLeft } from "lucide-react";

import { Icon } from "./Icon";

/* The way up from a page, above its title: an arrow and "Back to …", tertiary until hovered. `render` takes a router `<Link>`. */
export function BackLink({
  children,
  render,
}: {
  children: string;
  render: useRender.ComponentProps<"a">["render"];
}) {
  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      { className: "ui-back-link" },
      {
        children: (
          <>
            <Icon icon={ArrowLeft} size={14} />
            {children}
          </>
        ),
      },
    ),
    render,
  });
}

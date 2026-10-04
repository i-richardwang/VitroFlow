import { Link } from "@tanstack/react-router";

import { m } from "../paraglide/messages";
import { Button } from "./kit/Button";
import { WorkbenchEmpty } from "./shell/Workbench";

/** A route that could not be shown, in place of the whole page, with the way back to the experiments. */
export function RouteNotice({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <WorkbenchEmpty
      title={title}
      description={description}
      action={
        <Button render={<Link to="/experiments" />}>
          {m.return_to_experiments()}
        </Button>
      }
    />
  );
}

import { Link } from "@tanstack/react-router";

import { m } from "../../paraglide/messages";
import { Button } from "../kit/Button";
import { WorkbenchEmpty } from "./Workbench";

/** A page that could not be shown, with the way back to the experiments. */
export function WorkbenchNotice({
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

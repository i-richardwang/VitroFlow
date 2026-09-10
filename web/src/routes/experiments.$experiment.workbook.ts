import { getLocalTimeZone, today } from "@internationalized/date";
import { createFileRoute } from "@tanstack/react-router";

import {
  experimentWorkbook,
  experimentWorkbookFilename,
} from "../features/experiments/workbook";
import { readExperimentGrid } from "../server/experiments/public";
import { listModels } from "../server/models/public";
import { workbookResponse } from "../server/transport/http/workbook";

export const Route = createFileRoute("/experiments/$experiment/workbook")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const grid = await readExperimentGrid(params.experiment);
        if (!grid) return new Response("Not found", { status: 404 });
        const workbook = experimentWorkbook(
          { ...grid, models: await listModels() },
          today(getLocalTimeZone()).toString(),
        );
        return workbookResponse(
          workbook,
          experimentWorkbookFilename(grid.experiment),
        );
      },
    },
  },
});

import { createFileRoute, Link } from "@tanstack/react-router";
import { FlaskConical, Plus } from "lucide-react";
import { useState } from "react";

import {
  ImageAnalysisStatus,
  summarizedImageAnalysis,
} from "../../features/experiments/ImageAnalysisStatus";
import { joinFacts } from "../../features/experiments/labels";
import { NewExperimentDialog } from "../../features/experiments/NewExperimentDialog";
import { getExperiments } from "../../functions/experiments";
import { documentTitle } from "../../ui/documentTitle";
import { Day } from "../../ui/Day";
import { formatList } from "../../ui/lists";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import {
  PageHeaderSkeleton,
  PageSkeleton,
  TableSkeleton,
} from "../../ui/kit/PageSkeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { TextLink } from "../../ui/kit/TextLink";
import { Page } from "../../ui/Page";

export const Route = createFileRoute("/_workbench/experiments/")({
  loader: () => getExperiments(),
  staticData: { crumbs: () => [{ label: m.experiments_title() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.experiments_title()) }],
  }),
  pendingComponent: () => (
    <PageSkeleton>
      <PageHeaderSkeleton action />
      <TableSkeleton />
    </PageSkeleton>
  ),
  component: ExperimentsPage,
});

function ExperimentsPage() {
  const experiments = Route.useLoaderData();
  const [creating, setCreating] = useState(false);

  return (
    <Page
      title={m.experiments_title()}
      actions={
        <Button type="primary" icon={Plus} onClick={() => setCreating(true)}>
          {m.experiment_new()}
        </Button>
      }
    >
      <Table narrow="cards" aria-label={m.experiments_title()}>
        <TableHeader>
          <tr>
            <TableHead>{m.experiments_column_experiment()}</TableHead>
            <TableHead>{m.experiments_column_material()}</TableHead>
            <TableHead>{m.experiments_column_treatments()}</TableHead>
            <TableHead>{m.experiments_column_inoculated()}</TableHead>
            <TableHead>{m.experiments_column_latest()}</TableHead>
            <TableHead>{m.experiments_column_analysis()}</TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {experiments.length ? (
            experiments.map(
              ({ experiment, treatmentNames, latestDay, counts }) => {
                const state = summarizedImageAnalysis(counts);
                const material = joinFacts(
                  [experiment.plantMaterial, experiment.explantType].filter(
                    Boolean,
                  ),
                );
                return (
                  <TableRow key={experiment.id} clickable>
                    <TableCell cellSlot="title">
                      <TextLink
                        className="block max-w-72 truncate"
                        render={
                          <Link
                            to="/experiments/$experiment"
                            params={{ experiment: experiment.id }}
                          />
                        }
                      >
                        {experiment.name}
                      </TextLink>
                    </TableCell>
                    <TableCell
                      cellLabel={m.experiments_column_material()}
                      className="text-fg-secondary"
                    >
                      <span className="block max-w-56 truncate">
                        {material || <Absent />}
                      </span>
                    </TableCell>
                    <TableCell
                      cellLabel={m.experiments_column_treatments()}
                      className="text-fg-secondary"
                    >
                      <span className="block max-w-56 truncate">
                        {treatmentNames.length > 0 ? (
                          formatList(treatmentNames)
                        ) : (
                          <Absent />
                        )}
                      </span>
                    </TableCell>
                    <TableCell
                      cellLabel={m.experiments_column_inoculated()}
                      className="whitespace-nowrap text-fg-tertiary tabular-nums"
                    >
                      <Day value={experiment.inoculatedOn} />
                    </TableCell>
                    <TableCell
                      cellLabel={m.experiments_column_latest()}
                      className="whitespace-nowrap text-fg-secondary tabular-nums"
                    >
                      {latestDay === null ? (
                        <Absent />
                      ) : (
                        m.observation_day_label({ day: latestDay })
                      )}
                    </TableCell>
                    <TableCell cellLabel={m.experiments_column_analysis()}>
                      {state ? (
                        <ImageAnalysisStatus state={state} />
                      ) : (
                        <Absent />
                      )}
                    </TableCell>
                  </TableRow>
                );
              },
            )
          ) : (
            <TableEmpty>
              <Empty
                icon={FlaskConical}
                title={m.experiments_empty()}
                description={m.experiments_empty_description()}
                action={
                  <Button icon={Plus} onClick={() => setCreating(true)}>
                    {m.experiment_new()}
                  </Button>
                }
              />
            </TableEmpty>
          )}
        </TableBody>
      </Table>
      <NewExperimentDialog open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}

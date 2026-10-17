import { Link, useRouter } from "@tanstack/react-router";
import { Fragment, useState } from "react";

import {
  countError,
  isCounted,
  type ComparedImage,
  type ComparedReading,
  type CountAccuracy,
  type VersionComparisonDetail,
} from "../../domain/models/comparison";
import { classCount, type Tally } from "../../domain/models/classes";
import type { Model, ModelVersion } from "../../domain/models/schema";
import { chooseCurrentVersion } from "../../functions/models";
import { m } from "../../paraglide/messages";
import { DialogSession, FormDialog } from "../../ui/FormDialog";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Flexbox } from "../../ui/kit/Flex";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { Text } from "../../ui/kit/Text";
import { TextLink } from "../../ui/kit/TextLink";
import { toast } from "../../ui/kit/Toast";
import { className } from "../../ui/model-names";
import { formatCount, formatPercent } from "../../ui/numbers";
import { formatError } from "./comparison";

const FORM_ID = "make-version-current";

/**
 * Where a person decides whether a version should read the model's images:
 * how it counts the reviewed images it never trained on beside the current
 * version, image by image, and what choosing it changes. It is open while
 * `version` names one, and keeps showing that version while it closes.
 */
export function VersionDialog({
  model,
  version,
  comparison,
  onClose,
}: {
  model: Model;
  version: ModelVersion | null;
  comparison: VersionComparisonDetail | null;
  onClose: () => void;
}) {
  const open = version !== null;
  const [shown, setShown] = useState({ version, comparison });
  if (open && (shown.version !== version || shown.comparison !== comparison)) {
    setShown({ version, comparison });
  }
  return (
    <DialogSession open={open}>
      {(afterClose) =>
        shown.version ? (
          <VersionSession
            model={model}
            version={shown.version}
            comparison={shown.comparison}
            open={open}
            onClose={onClose}
            afterClose={afterClose}
          />
        ) : null
      }
    </DialogSession>
  );
}

function VersionSession({
  model,
  version,
  comparison,
  open,
  onClose,
  afterClose,
}: {
  model: Model;
  version: ModelVersion;
  comparison: VersionComparisonDetail | null;
  open: boolean;
  onClose: () => void;
  afterClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();

  const submit = () => {
    void run(
      () =>
        chooseCurrentVersion({
          data: { model: model.id, version: version.id },
        }),
      m.version_not_made_current(),
    ).then(async (result) => {
      if (!result.ok) return;
      toast.success(m.version_made_current({ version: version.id }));
      onClose();
      await router.invalidate();
    });
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.version_dialog_title({ version: version.id })}
      okText={m.version_dialog_confirm()}
      formId={FORM_ID}
      busy={busy}
      width="wide"
      afterClose={afterClose}
    >
      <form
        id={FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Flexbox gap={16}>
          {comparison ? (
            <Comparison model={model} comparison={comparison} />
          ) : (
            <Text type="secondary">{m.version_dialog_no_comparison()}</Text>
          )}
          <Text type="tertiary">{m.version_dialog_effect()}</Text>
        </Flexbox>
      </form>
    </FormDialog>
  );
}

function Comparison({
  model,
  comparison,
}: {
  model: Model;
  comparison: VersionComparisonDetail;
}) {
  const { heldOut, candidate, current, accuracy, currentVersionId } =
    comparison;
  const total = formatCount(heldOut);
  const reading =
    candidate.read + candidate.failed < heldOut ||
    (current !== null && current.read + current.failed < heldOut);
  const failed = comparison.images.filter(
    (image) => image.candidate === "failed" || image.current === "failed",
  ).length;
  return (
    <Flexbox gap={12}>
      <Text type="secondary">
        {m.version_dialog_held_out({ count: total })}
        {currentVersionId === null ? ` ${m.version_dialog_no_current()}` : ""}
      </Text>
      {reading ? (
        <Text type="tertiary">
          {current
            ? m.version_dialog_reading({
                candidate: formatCount(candidate.read),
                current: formatCount(current.read),
                total,
              })
            : m.version_dialog_reading_alone({
                candidate: formatCount(candidate.read),
                total,
              })}
        </Text>
      ) : null}
      {failed > 0 ? (
        <Text type="warning">
          {m.version_dialog_failed({ count: formatCount(failed) })}
        </Text>
      ) : null}
      {accuracy ? (
        <AccuracyTable
          classes={model.classes}
          scored={comparison.scored}
          candidate={accuracy.candidate}
          current={
            currentVersionId && accuracy.current
              ? { versionId: currentVersionId, accuracy: accuracy.current }
              : null
          }
        />
      ) : (
        <Text type="tertiary">{m.version_dialog_waiting()}</Text>
      )}
      <ImageTable
        classes={model.classes}
        currentVersionId={currentVersionId}
        images={comparison.images}
      />
    </Flexbox>
  );
}

/** Each class's mean error and the share counted exactly, side by side. */
function AccuracyTable({
  classes,
  scored,
  candidate,
  current,
}: {
  classes: readonly string[];
  scored: number;
  candidate: CountAccuracy;
  current: { versionId: string; accuracy: CountAccuracy } | null;
}) {
  const rows = [
    ...classes.map((name) => ({
      key: name,
      label: m.version_dialog_mean_error({ class: className(name) }),
      value: (accuracy: CountAccuracy) =>
        formatError(accuracy.meanError[name] ?? 0),
      better: (left: CountAccuracy, right: CountAccuracy) =>
        (left.meanError[name] ?? 0) < (right.meanError[name] ?? 0),
    })),
    {
      key: "exact",
      label: m.version_dialog_exact(),
      value: (accuracy: CountAccuracy) =>
        formatPercent(accuracy.exact / scored),
      better: (left: CountAccuracy, right: CountAccuracy) =>
        left.exact > right.exact,
    },
  ];
  return (
    <Table aria-label={m.version_dialog_metric()} size="small">
      <TableHeader>
        <tr>
          <TableHead>{m.version_dialog_metric()}</TableHead>
          {current ? (
            <TableHead numeric>
              {m.version_dialog_column_current({ version: current.versionId })}
            </TableHead>
          ) : null}
          <TableHead numeric>{m.version_dialog_column_candidate()}</TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell>{row.label}</TableCell>
            {current ? (
              <TableCell numeric>
                <Text
                  as="span"
                  weight={
                    row.better(current.accuracy, candidate)
                      ? "medium"
                      : undefined
                  }
                >
                  {row.value(current.accuracy)}
                </Text>
              </TableCell>
            ) : null}
            <TableCell numeric>
              <Text
                as="span"
                weight={
                  current && row.better(candidate, current.accuracy)
                    ? "medium"
                    : undefined
                }
              >
                {row.value(candidate)}
              </Text>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function errorOf(
  classes: readonly string[],
  image: ComparedImage,
  reading: ComparedReading,
): number {
  return isCounted(reading) ? countError(classes, image.reviewed, reading) : -1;
}

/** The held-out images, the ones either version miscounts most first. */
function ImageTable({
  classes,
  currentVersionId,
  images,
}: {
  classes: readonly string[];
  currentVersionId: string | null;
  images: readonly ComparedImage[];
}) {
  const sorted = [...images].sort(
    (left, right) =>
      Math.max(
        errorOf(classes, right, right.candidate),
        errorOf(classes, right, right.current),
      ) -
      Math.max(
        errorOf(classes, left, left.candidate),
        errorOf(classes, left, left.current),
      ),
  );
  return (
    <Flexbox gap={8}>
      <Text weight="medium">{m.version_dialog_images()}</Text>
      <Table aria-label={m.version_dialog_images()} size="small" narrow="cards">
        <TableHeader>
          <tr>
            <TableHead>{m.version_dialog_column_image()}</TableHead>
            <TableHead>{m.version_dialog_column_reviewed()}</TableHead>
            {currentVersionId ? (
              <TableHead>
                {m.version_dialog_column_current({ version: currentVersionId })}
              </TableHead>
            ) : null}
            <TableHead>{m.version_dialog_column_candidate()}</TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {sorted.map((image) => (
            <TableRow key={image.digest}>
              <TableCell cellSlot="title">
                <ImageName image={image} />
              </TableCell>
              <TableCell cellLabel={m.version_dialog_column_reviewed()}>
                <Counts classes={classes} tally={image.reviewed} />
              </TableCell>
              {currentVersionId ? (
                <TableCell
                  cellLabel={m.version_dialog_column_current({
                    version: currentVersionId,
                  })}
                >
                  <ReadingCounts
                    classes={classes}
                    reviewed={image.reviewed}
                    reading={image.current}
                  />
                </TableCell>
              ) : null}
              <TableCell cellLabel={m.version_dialog_column_candidate()}>
                <ReadingCounts
                  classes={classes}
                  reviewed={image.reviewed}
                  reading={image.candidate}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Flexbox>
  );
}

function ImageName({ image }: { image: ComparedImage }) {
  if (!image.dataset) {
    return (
      <Text as="span" type="tertiary">
        {image.digest.slice(0, 12)}
      </Text>
    );
  }
  return (
    <TextLink
      render={
        <Link
          to="/datasets/$dataset/$digest"
          params={{ dataset: image.dataset.id, digest: image.digest }}
        />
      }
    >
      {image.dataset.filename}
    </TextLink>
  );
}

/** Each class's count, in the model's order; a count off the review is marked. */
function Counts({
  classes,
  tally,
  reviewed,
}: {
  classes: readonly string[];
  tally: Tally;
  reviewed?: Tally;
}) {
  return (
    <span className="whitespace-nowrap">
      {classes.map((name, index) => {
        const found = classCount(tally, name);
        const off =
          reviewed !== undefined && found !== classCount(reviewed, name);
        return (
          <Fragment key={name}>
            {index > 0 ? (
              <Text as="span" type="quaternary">
                {" · "}
              </Text>
            ) : null}
            <Text as="span" type="tertiary">
              {className(name)}{" "}
            </Text>
            <Text as="span" type={off ? "error" : undefined} weight="medium">
              {formatCount(found)}
            </Text>
          </Fragment>
        );
      })}
    </span>
  );
}

function ReadingCounts({
  classes,
  reviewed,
  reading,
}: {
  classes: readonly string[];
  reviewed: Tally;
  reading: ComparedReading;
}) {
  if (reading === null) {
    return (
      <Text as="span" type="quaternary">
        {m.version_dialog_pending()}
      </Text>
    );
  }
  if (reading === "failed") {
    return (
      <Text as="span" type="warning">
        {m.version_dialog_failed_cell()}
      </Text>
    );
  }
  return <Counts classes={classes} tally={reading} reviewed={reviewed} />;
}

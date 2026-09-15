import {
  Button,
  Label,
  ListBox,
  Select,
  TextField,
  TextArea,
  ProgressBar,
} from "@heroui/react";
import { useEffect, useState } from "react";
import { canonicalJson } from "../../lib/json/canonical";
import type { AnnotationRef } from "../../domain/annotation/schema";
import {
  SEED_ANNOTATION_RULES,
  DEFAULT_ANNOTATION_REGION,
  type AnnotationRun,
} from "../../domain/annotation-runs/schema";
import { SEED_DETECTOR_MODEL_ID } from "../../domain/models/builtins";
import type { Worker } from "../../domain/workers/schema";
import {
  getAnnotationRuns,
  getAnnotationWorkers,
  startAnnotationRun,
  stopAnnotationRun,
} from "../../functions/annotation-runs";
import { m } from "../../paraglide/messages";
import { errorMessage } from "../../ui/errors";
import { Section } from "./inspector";
import type { Calibration } from "./session";

/** A result is loaded only by an explicit action; polling never changes the draft. */
export function AiAnnotation({
  reference,
  calibration,
}: {
  reference: AnnotationRef;
  calibration: Extract<Calibration, { status: "ready" }>;
}) {
  const [runs, setRuns] = useState<AnnotationRun[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [workerId, setWorkerId] = useState("");
  const [runtimeName, setRuntimeName] = useState("");
  const [input, setInput] = useState<"empty" | "draft">("empty");
  const [region, setRegion] = useState(DEFAULT_ANNOTATION_REGION);
  const [rules, setRules] = useState(
    reference.modelId === SEED_DETECTOR_MODEL_ID ? SEED_ANNOTATION_RULES : "",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Retain the same id after an uncertain response. Changed inputs get a new id.
  const [request, setRequest] = useState<{
    fingerprint: string;
    id: string;
  } | null>(null);
  const { digest, modelId } = reference;
  const activeRun = runs.find(
    (run) => run.status === "queued" || run.status === "running",
  );
  const activeId = activeRun?.id;
  useEffect(() => {
    let active = true;
    void getAnnotationWorkers()
      .then((next) => {
        if (active) setWorkers(next);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await getAnnotationRuns({ data: { digest, modelId } });
        if (!active) return;
        setRuns(next);
      } catch (cause) {
        if (active) setError(errorMessage(cause));
      }
      if (active && activeId) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [digest, modelId, activeId]);
  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const [nextRuns, nextWorkers] = await Promise.all([
        getAnnotationRuns({ data: reference }),
        getAnnotationWorkers(),
      ]);
      setRuns(nextRuns);
      setWorkers(nextWorkers);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const selected = runs.find((run) => run.id === selectedId) ?? runs[0];
  const chosenWorker =
    workers.find((worker) => worker.workerId === workerId) ?? workers[0];
  const chosenRuntime =
    chosenWorker?.annotationRuntimes.find(
      (runtime) => runtime.runtime === runtimeName,
    ) ?? chosenWorker?.annotationRuntimes[0];
  async function start() {
    if (!chosenWorker || !chosenRuntime || busy) return;
    setBusy(true);
    setError(null);
    const values = {
      ref: reference,
      workerId: chosenWorker.workerId,
      runtime: chosenRuntime,
      input: input === "draft" ? calibration.instances : null,
      base: calibration.base,
      rules,
      region,
    };
    const fingerprint = canonicalJson(values);
    const id =
      request?.fingerprint === fingerprint ? request.id : crypto.randomUUID();
    setRequest({ fingerprint, id });
    try {
      const run = await startAnnotationRun({ data: { id, ...values } });
      setRuns((previous) => [run, ...previous.filter((v) => v.id !== run.id)]);
      setSelectedId(run.id);
      setRequest(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!activeRun) return;
    setBusy(true);
    setError(null);
    try {
      await stopAnnotationRun({ data: activeRun.id });
      setRuns((previous) =>
        previous.map((run) =>
          run.id === activeRun.id ? { ...run, status: "cancelled" } : run,
        ),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const stateLabels = {
    queued: m.ai_queued,
    running: m.ai_running,
    succeeded: m.ai_succeeded,
    failed: m.ai_failed,
    cancelled: m.ai_cancelled,
  };
  const disabled = busy || calibration.saving;
  return (
    <Section title={m.ai_annotation()}>
      <p className="text-xs text-muted">{m.ai_explanation()}</p>
      {workers.length ? (
        <Select
          fullWidth
          variant="secondary"
          selectedKey={chosenWorker?.workerId ?? null}
          onSelectionChange={(key) => key !== null && setWorkerId(String(key))}
          isDisabled={disabled || !!activeRun}
        >
          <Label>{m.ai_worker()}</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {workers.map((worker) => (
                <ListBox.Item
                  key={worker.workerId}
                  id={worker.workerId}
                  textValue={worker.workerId}
                >
                  {worker.workerId}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      ) : (
        <p className="text-sm text-muted">{m.ai_no_worker()}</p>
      )}
      {!!chosenWorker?.annotationRuntimes.length && (
        <Select
          fullWidth
          variant="secondary"
          selectedKey={chosenRuntime?.runtime ?? null}
          onSelectionChange={(key) =>
            key !== null && setRuntimeName(String(key))
          }
          isDisabled={
            disabled ||
            !!activeRun ||
            chosenWorker.annotationRuntimes.length === 1
          }
        >
          <Label>{m.ai_agent()}</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {chosenWorker.annotationRuntimes.map((runtime) => (
                <ListBox.Item
                  key={runtime.runtime}
                  id={runtime.runtime}
                  textValue={`${runtime.runtime === "pi" ? "Pi" : "Antigravity"} · ${runtime.model}`}
                >
                  {runtime.runtime === "pi" ? "Pi" : "Antigravity"} ·{" "}
                  {runtime.model}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      )}
      <Button variant="tertiary" isDisabled={disabled} onPress={refresh}>
        {m.ai_refresh()}
      </Button>
      <Select
        fullWidth
        variant="secondary"
        selectedKey={input}
        onSelectionChange={(key) => {
          if (key === "empty" || key === "draft") setInput(key);
        }}
        isDisabled={disabled || !!activeRun}
      >
        <Label>{m.ai_starting_point()}</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="empty" textValue={m.ai_from_image()}>
              {m.ai_from_image()}
              <ListBox.ItemIndicator />
            </ListBox.Item>
            <ListBox.Item id="draft" textValue={m.ai_from_draft()}>
              {m.ai_from_draft()}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          </ListBox>
        </Select.Popover>
      </Select>
      <Select
        fullWidth
        variant="secondary"
        selectedKey={String(region.coreSize)}
        onSelectionChange={(key) =>
          key !== null &&
          setRegion((value) => ({ ...value, coreSize: Number(key) }))
        }
        isDisabled={disabled || !!activeRun}
      >
        <Label>{m.ai_region_size()}</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {[128, 256, 512, 1024].map((size) => (
              <ListBox.Item
                key={size}
                id={String(size)}
                textValue={`${size} × ${size}`}
              >
                {size} × {size}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      <Select
        fullWidth
        variant="secondary"
        selectedKey={String(region.displayScale)}
        onSelectionChange={(key) =>
          key !== null &&
          setRegion((value) => ({ ...value, displayScale: Number(key) }))
        }
        isDisabled={disabled || !!activeRun}
      >
        <Label>{m.ai_display_scale()}</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {[1, 2, 3, 4].map((scale) => (
              <ListBox.Item
                key={scale}
                id={String(scale)}
                textValue={`${scale}×`}
              >
                {scale}×<ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      <p className="text-xs text-muted">
        {m.ai_region_explanation({ halo: region.halo })}
      </p>
      <TextField
        fullWidth
        variant="secondary"
        value={rules}
        onChange={setRules}
        isDisabled={disabled || !!activeRun}
      >
        <Label>{m.ai_rules()}</Label>
        <TextArea className="w-full text-xs" rows={4} maxLength={8000} />
      </TextField>
      <Button
        variant="secondary"
        isDisabled={disabled || !!activeRun || !chosenWorker || !rules.trim()}
        onPress={start}
      >
        {m.ai_start()}
      </Button>
      {activeRun ? (
        <div className="flex flex-col gap-2" role="status">
          <span className="text-sm">
            {stateLabels[activeRun.status]()} · {activeRun.progress.completed}/
            {activeRun.progress.total}
          </span>
          <ProgressBar
            className="w-full"
            value={activeRun.progress.completed}
            maxValue={activeRun.progress.total}
            aria-label={m.ai_progress()}
          >
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
          <Button variant="tertiary" isDisabled={disabled} onPress={cancel}>
            {m.ai_stop()}
          </Button>
        </div>
      ) : null}
      {runs.length ? (
        <Select
          fullWidth
          variant="secondary"
          selectedKey={selected?.id ?? null}
          onSelectionChange={(key) =>
            key !== null && setSelectedId(String(key))
          }
        >
          <Label>{m.ai_runs()}</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {runs.map((run) => (
                <ListBox.Item
                  key={run.id}
                  id={run.id}
                  textValue={`${new Date(run.createdAt).toLocaleString()} · ${stateLabels[run.status]()}`}
                >
                  {new Date(run.createdAt).toLocaleString()} ·{" "}
                  {stateLabels[run.status]()}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      ) : null}
      {selected?.result ? (
        <>
          <p className="text-xs text-muted">
            {m.ai_run_region({
              size: selected.region.coreSize,
              scale: selected.region.displayScale,
            })}
          </p>
          <p className="text-xs text-muted">
            {m.ai_result_summary({
              count: selected.result.document.instances.length,
              issues:
                selected.result.issues.length + selected.result.warnings.length,
              uncertain: selected.result.uncertainIds.length,
            })}
          </p>
          <Button
            variant="secondary"
            isDisabled={disabled}
            onPress={() =>
              calibration.loadInstances(selected.result!.document.instances)
            }
          >
            {m.ai_load_result()}
          </Button>
          <p className="text-xs text-muted">{m.ai_apply_explanation()}</p>
          {selected.result.issues.length > 0 ? (
            <details className="text-xs">
              <summary>{m.ai_issues()}</summary>
              <ul className="space-y-1">
                {selected.result.issues.map((issue, index) => (
                  <li key={index}>{issue.reason}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
      {selected?.error ? (
        <p role="alert" className="text-sm text-danger">
          {selected.error}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Section>
  );
}

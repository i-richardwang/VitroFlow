# vitroctl

Operator CLI and native Worker runtime for a [VitroFlow](https://github.com/i-richardwang/VitroFlow) workbench. The workbench owns experiments, datasets, review state, and training runs; this package runs the Workers that detect and train for it and moves datasets between a workbench and a local data root.

Worker services run under `launchd` and therefore require macOS. The `dataset`, `recognize`, and `traditional` commands run wherever Python 3.11+ is available.

## Install

```bash
uv tool install 'vitroctl[yolo]'
```

The `yolo` extra installs the pinned Ultralytics runtime that Workers advertise. Without it, a Worker serves the bundled traditional detector and takes no training runs.

## Workers

An administrator enrolls each machine on the workbench's Workers settings page, which shows the machine's token once. Each Worker profile holds that token and a private work directory; the workbench knows the worker by its token. Setup validates the token, runtime imports, and the selected device before saving the profile, then installs and starts a LaunchAgent:

```bash
vitroctl worker setup mac-studio \
  --server https://<workbench> \
  --device mps
```

The token is prompted without echo and stored in `~/.vitroflow/profiles/<profile>/config.toml` with mode `0600`; LaunchAgent files contain no credentials.

```bash
vitroctl worker list
vitroctl worker status mac-studio
vitroctl worker doctor mac-studio
vitroctl worker logs mac-studio --follow
vitroctl worker restart mac-studio
vitroctl worker stop mac-studio
```

`launchd` restarts a Worker that crashes. A Worker whose machine is removed from the Workers page stops and stays stopped, and `worker list` shows why; enroll the machine again and rerun `setup --force` with the new token.

`stop` and `restart` return once the Worker has exited; `restart` then loads the current LaunchAgent definition. Training runs in a supervised child process, so shutdown or detection of a revoked lease stops even a trainer blocked inside a GPU operation. The server revokes ownership immediately; the Worker detects revocation on its next training request or lease renewal. Each attempt uses a private directory that is removed when it exits.

Training presets pin model weights, parameters, and the framework version. A run stores its resolved recipe; resuming does not consult the preset registry. The shared trainer limits validation to the actual per-device training batch and records effective execution parameters in the Worker profile log.

Deploy parameter-contract extensions to all Workers, including inference Workers, before the Web server starts emitting them. Workers validate both training recipes and the training metadata in published model manifests. A framework version match alone does not establish application-contract compatibility.

The training dialog assigns work automatically or to a specific enrolled Worker. On a run's page, **Pause** revokes the current attempt and releases the model immediately; **Cancel training** ends the task. A paused or failed task can resume on any training Worker, or explicitly restart from the beginning. A pinned task waits for its selected Worker rather than silently moving elsewhere.

After each resumable epoch, the Worker uploads a checkpoint containing the optimizer state, last and best weights, and epoch journal to shared storage. Resume restores that checkpoint on the chosen machine with the recipe's pinned runtime. Work after the last uploaded checkpoint is discarded; without a checkpoint, resume starts from the beginning. An invalid checkpoint fails visibly instead of silently restarting. Checkpoints for paused and failed tasks remain available; cancelled, completed, superseded, and explicitly discarded checkpoints are collected by maintenance.

The run page shows execution history, its current Worker, the last progress time, and the saved checkpoint's epoch. Lease renewal does not count as training progress. A run without progress for 15 minutes shows a warning, and an expired lease is shown separately. Every training execution request carries the execution attempt as well as its session, so cancelled or superseded attempts cannot report progress or publish models.

`vitroctl worker run <profile>` runs a Worker in the foreground without `launchd`.

## Datasets

Dataset transfer uses `/api/transfer/` with a personal API key that holds the transfer scope:

```bash
export VITROFLOW_SERVER_URL=https://<workbench>
export VITROFLOW_API_KEY=<api-key>

vitroctl dataset pull --dataset fixtures --data-root data
vitroctl dataset push --dataset fixtures --data-root data
```

A local data root shares content-addressed blobs across datasets:

```text
data/
├── blobs/<xx>/<sha256>
└── datasets/<dataset>.json
```

Annotations export as a deterministic YOLO dataset:

```bash
vitroctl dataset export-yolo \
  --dataset fixtures \
  --data-root data \
  --output output/datasets/fixtures-yolo \
  --validation-fraction 0.2 \
  --seed 42
```

`vitroctl recognize` runs the bundled traditional detector over a pulled dataset, and `vitroctl traditional evaluate` and `vitroctl traditional train` score and retrain its candidate scorer from reviewed annotations.

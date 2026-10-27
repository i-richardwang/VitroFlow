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

`stop` and `restart` return once the Worker has exited; `restart` then loads the current LaunchAgent definition. Training runs in a supervised child process, so shutdown or detection of a revoked lease stops even a trainer blocked inside a GPU operation. The server revokes ownership immediately; the Worker detects revocation on its next training request or lease renewal. Each attempt uses a private directory. Completed but undelivered bundles are retained; other attempt directories are removed when execution exits.

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

## Training and model delivery

Training and model registration are independent. A Worker and local training produce the same **Model Bundle**: `bundle.json` and `weights.pt`. The manifest fixes ordered classes, weight digest and size, inference settings, the training recipe, runtime requirements, dataset provenance, and evaluation/calibration evidence. Checkpoints remain separate and are only needed to continue training.

A training specification is JSON with `dataset` and `recipe`. `recipe` has the same structure as the `recipe` member in `configs/yolo26/yolo26n-whole-v1.recipe.json`: pinned base-model reference and digest, training parameters, and framework version. Optional `nbs`, scale, rotation, flip, translation and HSV parameters override the pinned framework's defaults. The resolved scalar trainer arguments and a training-code fingerprint are saved in `training-context.json` and included in generated bundles. Final validation uses the actual bounded validation batch, including automatic batch reductions.

For local training, `dataset` is the name of a previously pulled dataset. For managed training, it is the workbench dataset ID returned by `list-datasets`.

```bash
# Local compute; no server or Worker registration required.
vitroctl training run --local --spec training.json --data-root data \
  --device mps --output output/my-training

# Continue an interrupted local run with exactly the same inputs.
vitroctl training run --local --resume --spec training.json --data-root data \
  --device mps --output output/my-training

# Workbench operations require an API key with the experiments scope.
vitroctl training workers
vitroctl training run --spec managed-training.json --worker mac-studio
vitroctl training list --model seed-detector
vitroctl training get <run-id>
vitroctl training pause <run-id> --dataset <dataset-id> --attempt 1
vitroctl training resume <run-id> --dataset <dataset-id> --attempt 1 --worker another-worker
vitroctl training cancel <run-id> --dataset <dataset-id> --attempt 2
```

Local outputs retain the fixed input manifest, exported data and split membership, checkpoints, epoch journal, inference summary, and `bundle/`. Resume checks the saved inputs before using a checkpoint; changing data or parameters requires another output directory. A completed training cannot be resumed from a stripped final checkpoint. Its bundle can still be imported repeatedly without training.

```bash
# Register a candidate; this never changes the current model selection.
vitroctl models import output/my-training/bundle --model seed-detector
vitroctl models list --model seed-detector

# Select the returned version ID explicitly. Selecting an earlier ID rolls back.
vitroctl models use --model seed-detector --version <version-id>
```

For existing experimental weights, prepare a manifest matching [the bundle contract](../src/vitroctl/contracts/model-bundle.schema.json). The `weights` descriptor can be omitted from the input metadata; `pack` computes it. Include the actual class order, chosen confidence and image size, original recipe, selected epoch if known, data fingerprint if available, and the separate calibration/evaluation descriptions. Unknown provenance is explicitly `null`; do not invent a snapshot or report full-dataset training for a subset experiment.

```bash
vitroctl models pack --weights output/experiment/weights/last.pt \
  --metadata experiment-bundle.json --output output/candidate
vitroctl models import output/candidate --model seed-detector
```

Packaging and CLI import load the weights on CPU to verify their ordered classes and require the declared Ultralytics version. The supported delivery pipeline is `mode: "whole_image"` with explicit `iou: 0.7`. Tiling or another IoU is rejected instead of silently changing the experiment's inference behavior. Such pipelines require an adapter and contract extension before they can be registered. Registration validates metadata and byte identity; a reported accuracy metric is provenance, not a platform-certified score. Imported versions remain candidates until selected.

The workbench uses content-derived upload identities and version identities covering the entire bundle and its origin. Repeating import safely returns the same version; changing inference settings creates another version even with identical weights. Upload reservations expire after 24 hours unless registered, and preparing the same bundle renews the reservation. Upload and registration are separate so connection failures can be retried. Delivered versions retain their immutable bytes independently of their training run.

A Worker retains a finished bundle in its attempt directory if publication fails, and this directory is excluded from stale-run cleanup. Import that bundle with the CLI to recover the completed work. A successful publication removes the local attempt directory; shared checkpoints follow the training lifecycle.

### HTTP and MCP

The existing experiments MCP endpoint exposes `list-training-workers`, `start-training`, `get-training`, `list-training`, `control-training`, `list-model-versions`, `prepare-model-upload`, `register-model-upload`, and `use-model-version`. These are the same operations exposed through `POST /api/agent/<operation>`; schema discovery remains `GET /api/agent/operations`.

`start-training` returns a task immediately; MCP does not execute a long GPU computation. To import local files, the CLI calls `prepare-model-upload`, PUTs raw weights to the returned upload path using its API key, then calls `register-model-upload`. An MCP client can prepare and register uploads but cannot read a user's local filesystem on its own. Weight transfers use HTTP, never base64 inside an MCP tool call.

### Deployment

Deploy Web and Worker together. Database initialization applies the model-registry migration automatically. It adds upload reservations and independent weight locations, and records existing versions' locations without moving or rewriting their weight bytes. Model selection and historical predictions are preserved. Workers must be upgraded because their publication payload is now a Model Bundle; their existing profiles and enrollment tokens remain valid.

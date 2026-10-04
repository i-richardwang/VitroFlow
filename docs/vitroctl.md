# vitroctl

Operator CLI and native Worker runtime for a [VitroFlow](https://github.com/i-richardwang/VitroFlow) workbench. The workbench owns experiments, datasets, review state, and training runs; this package runs the Workers that detect and train for it and moves datasets between a workbench and a local data root.

Worker services run under `launchd` and therefore require macOS. The `dataset`, `recognize`, and `traditional` commands run wherever Python 3.11+ is available.

## Install

```bash
uv tool install 'vitroctl[yolo]'
```

The `yolo` extra installs the pinned Ultralytics runtime that Workers advertise. Without it, a Worker serves the bundled traditional detector and takes no training runs.

## Workers

An administrator enrolls each machine on the workbench's Status page, which shows the machine's token once. Each Worker profile holds that token and a private work directory; the workbench knows the worker by its token. Setup validates the token, runtime imports, and the selected device before saving the profile, then installs and starts a LaunchAgent:

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

`launchd` restarts a Worker that crashes. A Worker whose machine is removed from the Status page stops and stays stopped, and `worker list` shows why; enroll the machine again and rerun `setup --force` with the new token.

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

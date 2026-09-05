# vitroflow

Command-line client and native Worker runtime for a [VitroFlow](https://github.com/i-richardwang/VitroFlow) workbench. The workbench owns experiments, datasets, review state, and training runs; this package runs the Workers that detect and train for it and moves datasets between a workbench and a local data root.

Worker services run under `launchd` and therefore require macOS. The `dataset`, `recognize`, and `traditional` commands run wherever Python 3.11+ is available.

## Install

```bash
uv tool install 'vitroflow[yolo]'
```

The `yolo` extra installs the pinned Ultralytics runtime that Workers advertise. Without it, a Worker serves only the bundled traditional detector and takes no training runs.

## Workers

Each Worker profile has a stable worker ID, the workbench worker credential, and a private work directory. Setup validates authentication, runtime imports, and the selected device before saving the profile, then installs and starts a LaunchAgent:

```bash
vitroflow worker setup mac-studio \
  --server https://<workbench> \
  --device mps
```

The Worker token is prompted without echo and stored in `~/.vitroflow/profiles/<profile>/config.toml` with mode `0600`; LaunchAgent files contain no credentials.

```bash
vitroflow worker list
vitroflow worker status mac-studio
vitroflow worker doctor mac-studio
vitroflow worker logs mac-studio --follow
vitroflow worker restart mac-studio
vitroflow worker stop mac-studio
```

`vitroflow worker run <profile>` runs a Worker in the foreground without `launchd`.

## Datasets

Dataset transfer uses `/api/transfer/` with a personal API key that holds the transfer scope:

```bash
export VITROFLOW_SERVER_URL=https://<workbench>
export VITROFLOW_API_KEY=<api-key>

vitroflow dataset pull --dataset fixtures --data-root data
vitroflow dataset push --dataset fixtures --data-root data
```

A local data root shares content-addressed blobs across datasets:

```text
data/
├── blobs/<xx>/<sha256>
└── datasets/<dataset>.json
```

Annotations export as a deterministic YOLO dataset:

```bash
vitroflow dataset export-yolo \
  --dataset fixtures \
  --data-root data \
  --output output/datasets/fixtures-yolo \
  --validation-fraction 0.2 \
  --seed 42
```

`vitroflow recognize` runs the bundled traditional detector over a pulled dataset, and `vitroflow traditional evaluate` and `vitroflow traditional train` score and retrain its candidate scorer from reviewed annotations.

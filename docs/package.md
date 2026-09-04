# vitroflow

Command-line client and native Worker runtime for a [VitroFlow](https://github.com/i-richardwang/VitroFlow) workbench. The workbench owns experiments, datasets, review state, and training runs; this package runs the inference and training Workers that serve it and moves datasets between a workbench and a local data root.

Worker services run under `launchd` and therefore require macOS. The `dataset`, `recognize`, and `traditional` commands run wherever Python 3.11+ is available.

## Install

```bash
uv tool install 'vitroflow[yolo]'
```

The `yolo` extra installs the pinned Ultralytics runtime that inference and training Workers advertise. Without it, an inference Worker serves only the bundled traditional detector and a training Worker cannot start.

## Workers

Each Worker profile has a stable worker ID, role-specific credentials, runtime capabilities, and a private work directory. Setup validates authentication, runtime imports, and the selected device before saving the profile, then installs and starts a LaunchAgent:

```bash
vitroflow worker setup inference mac-inference \
  --server https://<workbench> \
  --device mps

vitroflow worker setup training mac-training \
  --server https://<workbench> \
  --device mps
```

The Worker token is prompted without echo and stored in `~/.vitroflow/profiles/<profile>/config.toml` with mode `0600`; LaunchAgent files contain no credentials.

```bash
vitroflow worker list
vitroflow worker status mac-training
vitroflow worker doctor mac-training
vitroflow worker logs mac-training --follow
vitroflow worker restart mac-training
vitroflow worker stop mac-training
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

Complete annotations export as a deterministic YOLO dataset:

```bash
vitroflow dataset export-yolo \
  --dataset fixtures \
  --data-root data \
  --output output/datasets/fixtures-yolo \
  --validation-fraction 0.2 \
  --seed 42
```

`vitroflow recognize` runs the bundled traditional detector over a pulled dataset, and `vitroflow traditional evaluate` and `vitroflow traditional train` score and retrain its candidate scorer from complete annotations.

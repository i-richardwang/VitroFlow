# VitroFlow

VitroFlow turns petri-dish photographs into reviewed seed bounding boxes. It combines a Web annotation workbench, a compute Worker, a traditional-vision prelabel pipeline, and dataset export for detector training.

## System workflow

```text
Upload images in the workbench
          ↓
Worker creates initial detections
          ↓
Reviewer completes box annotations
          ├──→ retrain and evaluate candidate scoring
          └──→ export a YOLO detection dataset
```

The data directory is the shared contract between these stages:

```text
data/
├── images/<dataset>/<file>.jpg   source photographs
├── jobs/<job-id>.json            recognition job state
├── runs/<run-id>/                detection results and rendered views
├── labels/<dataset>/<stem>.json  reviewed box annotations
└── staging/<job-id>/             Worker uploads awaiting publication
```

An image is identified by its path under `images/`. Annotation documents marked `complete` are the canonical training data. Editing a completed annotation returns it to `in_progress`; excluded images are omitted from training and export.

## Local recognition

Install the Python environment and recognize one image or a directory:

```bash
uv sync
uv run vitroflow recognize data/images/fixtures \
  --data-root data \
  --output data/runs/local-review
```

Each image produces a result JSON, an overlay, and a diagnostic image. The batch also produces `counts.csv`. `--data-root` controls the source paths recorded in result JSON, so images used by the workbench should be recognized with `data` as their root.

Pass a trained model or a pipeline configuration explicitly when needed:

```bash
uv run vitroflow recognize data/images/fixtures \
  --data-root data \
  --output output/review \
  --model output/models/candidate-seedness/model.json \
  --config config/pipeline.json
```

## Workbench and Worker

Start the annotation workbench for local development:

```bash
cd web
bun install
bun run dev
```

The Jobs page accepts image batches and queues recognition work. The Worker downloads source images through the authenticated API, runs the same recognition core used by the local command, and uploads validated artifacts through the API:

```bash
export VITROFLOW_SERVER_URL=https://vitroflow.example.com
export VITROFLOW_WORKER_TOKEN=<worker-secret>
uv run vitroflow-worker
```

Use `--model` and `--config` to run a selected candidate model and pipeline configuration. They are loaded once at Worker startup, so every image handled by that process has a stable execution identity. `--once` processes at most one job and exits.

The workbench reads `VITROFLOW_DATA_ROOT` (default: `../data` relative to `web/`). For a container deployment:

```bash
docker compose up --build
```

`compose.yaml` mounts `./data` at `/data` and serves port 3000. `VITROFLOW_PASSWORD` protects the workbench; `VITROFLOW_WORKER_TOKEN` is the separate Worker credential. A job accepts up to 100 images, 64 MiB per image, and 512 MiB in total.

## Prelabel workflow

The prelabel pipeline generates candidate centers and candidate-local evidence. Its candidate model combines a regularized global classifier with bounded local calibration. Scale-aware deduplication turns the scored candidates into the initial boxes shown in the workbench.

Evaluate the current model on all complete annotations:

```bash
uv run vitroflow prelabel evaluate --data-root data
```

The report separates proposal recall from final detection precision and recall. Proposal recall measures whether the candidate generator reaches each reviewed box; final metrics measure the corrections required after scoring and deduplication.

Train with leave-one-image-out selection of calibration bandwidth and regularization, then evaluate the resulting artifact:

```bash
uv run vitroflow prelabel train \
  --data-root data \
  --output output/models/candidate-seedness

uv run vitroflow prelabel evaluate \
  --data-root data \
  --model output/models/candidate-seedness/model.json
```

Training publishes `model.json` and `report.json` together in a new artifact directory. Selecting a candidate model for recognition is an explicit deployment choice through `--model`.

## YOLO dataset export

Export complete box annotations as a deterministic YOLO detection dataset:

```bash
uv run vitroflow dataset export-yolo \
  --data-root data \
  --output output/datasets/seeds-v1 \
  --validation-fraction 0.2 \
  --seed 42
```

The export contains copied source images, normalized YOLO labels, `dataset.yaml`, and a manifest recording source paths, revisions, and train/validation assignments. Recognition runs, training artifacts, and dataset exports are published atomically to new directories.

## Recognition pipeline

```text
Dish geometry
→ Reference-region Lab normalization
→ Multi-scale center proposals
→ Candidate-local evidence
→ Candidate model scoring
→ Scale-aware response deduplication
→ Counting and rendering
```

Candidate evidence covers local contrast, chroma, finite support, directional continuation, texture, surface compatibility, scale persistence, shape, and rim clearance. Geometric scales are fractions of the detected dish radius.

Runtime parameters are grouped by responsibility in `PipelineConfig`. A nested JSON file can override selected values:

```json
{
  "geometry": {
    "reference_radius_fraction": 0.6,
    "search_radius_fraction": 0.9
  },
  "decision": {
    "confidence_threshold": 0.889313
  }
}
```

## Project layout

```text
src/vitroflow/
├── geometry.py       Dish and analysis regions
├── normalization.py  Reference-based image normalization
├── proposals.py      Multi-scale candidate generation
├── candidates.py     Candidate-local evidence
├── scoring.py        Candidate model schema and scoring
├── detection.py      Confidence selection and deduplication
├── pipeline.py       Shared recognition orchestration
├── artifacts.py      Result serialization
├── files.py          Atomic artifact publication
├── annotations.py    Canonical reviewed-label loading
├── prelabel/
│   ├── data.py       Candidate labels from reviewed boxes
│   ├── evaluation.py Detection metrics
│   └── training.py   Candidate-model selection and fitting
├── yolo.py           YOLO dataset export
├── cli.py            Local workflows
└── worker.py         Remote recognition execution

web/src/
├── annotation/       Box annotation domain
├── components/       Review workbench UI
├── detection/        Recognition result contract
└── server/           Jobs, labels, runs, and Worker API
```

## Development

```bash
uv sync --group dev
uv run ruff check src tests
uv run ruff format --check src tests
uv run pytest
cd web && bun test && bun run build
```

Local image fixtures are described in [`tests/fixtures/README.md`](tests/fixtures/README.md).

Recognition results can report `dish_detection_failed`, `exposure_clipping`, or `low_focus` when an image needs additional review.

## License

[MIT](LICENSE)

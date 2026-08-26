# VitroFlow

VitroFlow turns petri-dish photographs into reviewed seed bounding boxes. It combines a Web annotation workbench, a compute Worker, a traditional-vision prelabel pipeline, and dataset export for detector training.

## System workflow

```text
Upload a dataset of images in the workbench
          ↓
Worker prelabels every pending image
          ↓
Reviewer completes box annotations
          ├──→ retrain and evaluate candidate scoring
          └──→ export a YOLO detection dataset
```

The data directory is the shared contract between these stages:

```text
data/
├── images/<dataset>/<stem>.<ext>    source photographs; the stem identifies the image
├── prelabels/<dataset>/<stem>.json  Worker-owned detector output, untouched by humans
├── labels/<dataset>/<stem>.json     reviewed box annotations
└── workers/<worker-id>.json         latest heartbeat from each Worker
```

A dataset is a directory of images that trains one model. An image's state follows from which files exist for it. Without a prelabel it is `pending`; a prelabel that carries an `error` key marks it `failed`; a prelabel result makes it `prelabeled`; once a label exists the label's `status` applies and the prelabel is never modified again. Prelabels of unlabelled images are replaced whenever a Worker with a different pipeline or model fingerprint processes them.

An image is identified by its path under `images/`. Annotation documents marked `complete` are the canonical training data. Editing a completed annotation returns it to `in_progress`; excluded images are omitted from training and export.

## Local recognition

Install the Python environment and recognize one image or a directory:

```bash
uv sync
uv run vitroflow recognize data/images/fixtures \
  --data-root data \
  --output output/local-review
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

Uploading images to a dataset is all it takes to request prelabels. The Worker polls the authenticated API for pending images, downloads each source image, runs the same recognition core used by the local command, and uploads the resulting prelabel JSON:

```bash
export VITROFLOW_SERVER_URL=https://vitroflow.example.com
export VITROFLOW_WORKER_TOKEN=<worker-secret>
uv run vitroflow-worker
```

Use `--model` and `--config` to run a selected candidate model and pipeline configuration. They are loaded once at Worker startup, so every image handled by that process has a stable execution identity. `--once` runs a single pass over the pending images and exits.

The Worker protocol has four calls under the workbench URL, each authenticated with `Authorization: Bearer <token>`:

| Call | Purpose |
|---|---|
| `POST api/worker/heartbeat` | worker id, start time, execution identity, and the image currently in progress |
| `GET api/worker/pending?pipeline=<fp>&model=<fp>` | images with no prelabel, or whose prelabel came from other fingerprints, excluding labelled images |
| `GET api/worker/images/<dataset>/<stem>` | source image bytes |
| `PUT api/worker/prelabels/<dataset>/<stem>` | prelabel document; `409` when a label already exists and the Worker skips the image |

Each pass heartbeats, fetches the pending list, then per image heartbeats, downloads, detects, and uploads. A detection error becomes a failure document (`source`, `error`, `pipeline`, `model`, `config`), the image shows as `failed`, and the pass continues; a failed image is processed again once its prelabel is discarded from the workbench or a Worker with other fingerprints arrives. Prelabels are JSON only; rendered views belong to local recognition.

The Worker identifies itself by hostname, or by `--worker-id` / `VITROFLOW_WORKER_ID`. The Status page lists each Worker with its presence, current image, and model.

The workbench reads `VITROFLOW_DATA_ROOT` (default: `../data` relative to `web/`). For a container deployment:

```bash
docker compose up --build
```

`compose.yaml` mounts `./data` at `/data` and serves port 3000. `VITROFLOW_PASSWORD` protects the workbench; `VITROFLOW_WORKER_TOKEN` is the separate Worker credential.

To deploy the Worker to an arm64 Wonder Mesh server on Zeabur, create another GitHub service from this repository and name the service `worker`. Zeabur selects `Dockerfile.worker` by service name. Configure one replica with:

```env
VITROFLOW_SERVER_URL=https://vitroflow.example.com
VITROFLOW_WORKER_TOKEN=<worker-secret>
```

The container serves `/healthz` on Zeabur's `PORT`. Keep the Worker private; its only application traffic is outbound to the workbench API.

## Prelabel workflow

The prelabel pipeline generates candidate centers and candidate-local evidence. Its candidate model combines a regularized global classifier with bounded local calibration. Scale-aware deduplication turns the scored candidates into the initial boxes shown in the workbench.

Evaluate the current model on all complete annotations:

```bash
uv run vitroflow prelabel evaluate --data-root data
```

The report separates proposal recall from final detection precision and recall. Proposal recall measures whether candidate generation reaches each reviewed box; final metrics measure the corrections required after scoring and deduplication.

Train with leave-one-image-out selection of model form, regularization, and confidence threshold, then evaluate the resulting artifact:

```bash
uv run vitroflow prelabel train \
  --data-root data \
  --output output/models/candidate-seedness

uv run vitroflow prelabel evaluate \
  --data-root data \
  --model output/models/candidate-seedness/model.json \
  --config output/models/candidate-seedness/config.json
```

Training publishes `model.json`, its selected `config.json`, and `report.json` together in a new artifact directory. Selecting an artifact for recognition is explicit through `--model` and `--config`.

## YOLO dataset export

Export complete box annotations as a deterministic YOLO detection dataset:

```bash
uv run vitroflow dataset export-yolo \
  --data-root data \
  --output output/datasets/seeds-v1 \
  --validation-fraction 0.2 \
  --seed 42
```

The export contains copied source images, normalized YOLO labels, `dataset.yaml`, and a manifest recording source paths, revisions, and train/validation assignments. Training artifacts and dataset exports are published atomically to new directories.

## YOLO26 fine-tuning

Until complete human-reviewed labels are available, build a temporary dataset from
a dataset's prelabels. During this bootstrap phase they are treated as training
targets, so validation metrics measure agreement with the traditional algorithm
rather than final real-world accuracy. Failure documents are skipped, and the
output stays outside `data/labels`:

```bash
uv run python scripts/build_yolo_prelabels.py \
  --prelabels data/prelabels/<dataset> \
  --data-root data \
  --output output/yolo/prelabels-smoke \
  --seed 42
```

Install the separate training dependencies and run the documented small-dataset
fine-tuning recipe through the Ultralytics Python API:

```bash
uv sync --group train

uv run --group train python scripts/train_yolo.py \
  --data output/yolo/prelabels-smoke/dataset.yaml \
  --output output/yolo/train-seed-small \
  --model yolo26n.pt \
  --config configs/yolo26/seed-small.yaml \
  --device mps
```

The checked-in recipe follows Ultralytics' YOLO26 guidance for datasets with fewer
than 1,000 images: AdamW at `lr0=0.001`, 50 epochs, and early stopping with
`patience=20`. Mosaic is disabled using the guide's very-small-dataset fallback:
each dish already contains hundreds of tiny targets, and combining four dishes
made MPS target assignment pathologically expensive. The recipe deliberately
leaves Ultralytics' gradient accumulation and three-epoch warmup unchanged. It uses
`imgsz=1024` because a seed box is only about five pixels wide at the default 640;
Ultralytics also recommends increasing resolution for small-object datasets. The
M5 Pro recipe uses `batch=8` as a conservative fixed size for the available 24 GB
unified memory; it remains a runtime override for machines with different capacity.

After training, the script verifies `best.pt`, runs a full validation pass with
YOLO26's one-to-many head, and writes `inference.json` beside the weights. That file
records the validation metrics and the confidence calibrated from Ultralytics'
public F1-confidence curve together with `imgsz`, `max_det`, and head mode. A run
whose validation F1 is still zero is recorded as `ready: false` with no confidence,
rather than publishing an unsafe zero threshold. This
keeps deployment settings out of training hyperparameters and avoids treating the
default end-to-end head's 300 detections as the seed-counting ceiling. Recalibrate
against reviewed labels when they are ready by using the regular
`dataset export-yolo` output with the same config and training script.

References: [YOLO26 training recipe](https://docs.ultralytics.com/guides/yolo26-training-recipe/),
[fine-tuning guide](https://docs.ultralytics.com/guides/finetuning-guide/), and
[YOLO26 dual-head behavior](https://docs.ultralytics.com/models/yolo26/).

Ultralytics YOLO26 is offered under AGPL-3.0 and Enterprise licenses. Resolve the
appropriate license before integrating its runtime into a production Worker.

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
├── image_io.py       Image decoding
├── geometry.py       Dish and analysis regions
├── normalization.py  Reference-based image normalization
├── proposals.py      Multi-scale candidate generation
├── candidates.py     Candidate-local evidence
├── scoring.py        Candidate model schema and scoring
├── detection.py      Confidence selection and deduplication
├── pipeline.py       Shared recognition orchestration
├── models.py         Result records and their JSON form
├── identity.py       Pipeline, model, and configuration fingerprints
├── regions.py        Seed regions for rendered views
├── rendering.py      Overlay and diagnostic views
├── artifacts.py      Result and view serialization
├── files.py          Atomic artifact publication
├── annotations.py    Canonical reviewed-label loading
├── prelabel/
│   ├── data.py       Candidate labels from reviewed boxes
│   ├── evaluation.py Proposal and detection metrics
│   └── training.py   Model and threshold selection
├── yolo/
│   ├── dataset.py    Canonical reviewed-label export
│   ├── bootstrap.py  Prelabel bootstrap adapter
│   └── training.py   Ultralytics training and validation
├── cli.py            Local workflows
└── worker.py         Remote prelabel execution

web/src/
├── datasets/         Dataset and image identity, derived image states
├── detection/        Prelabel document contract
├── annotation/       Box annotation domain
├── workers/          Worker heartbeat contract
├── components/       Review workbench UI
├── hooks/            Annotation persistence and history
├── routes/           Pages, image delivery, and Worker API
└── server/           Datasets, prelabels, labels, and Worker presence
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

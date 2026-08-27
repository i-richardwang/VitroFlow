# VitroFlow

VitroFlow turns petri-dish photographs into reviewed seed bounding boxes. The Web workbench is the control plane; independent inference and training Workers may run on different machines.

## System workflow

```text
Upload a dataset of images in the workbench
          ↓
Inference Worker prelabels every pending image
          ↓
Reviewer completes box annotations
          ↓
Server freezes a DatasetSnapshot and queues a TrainingRun
          ↓
Training Worker fine-tunes and validates YOLO26
          ↓
Server publishes a candidate ModelVersion
```

Postgres holds every record the stages exchange; the data directory holds only binary content the records reference:

| Table | Owner | Contents |
|---|---|---|
| `datasets`, `models`, `model_versions` | Server | a Dataset, its logical Model, and immutable executable ModelVersions |
| `images` | Server | one row per photograph, identified by the SHA-256 of its bytes |
| `dataset_images` | Server | an image's membership in a dataset and its stable train/validation split |
| `prelabels` | Inference Worker | detector output for an image in a dataset, untouched by humans |
| `labels` | Reviewer | reviewed box annotations with a revision counter |
| `inference_workers`, `training_workers` | Workers | latest heartbeat per process |
| `dataset_snapshots`, `dataset_snapshot_images` | Server | immutable sets of reviewed training inputs |
| `training_runs` | Server | leased training state machines; a partial unique index allows one active run per model |

```text
data/
├── images/<xx>/<sha256>             immutable source photographs, addressed by content
├── training-staging/<run>/          uploaded but unpublished model artifacts
└── model-artifacts/<version>/       server-published YOLO weights and settings
```

A Dataset owns one logical Model—the purpose of the model, not one artifact—and selects one of its immutable ModelVersions for prelabelling. The dataset page is that model's console: it lists every candidate version with its validation metrics and the Workers serving it, starts training from the reviewed annotations, follows each TrainingRun, and switches the selected version explicitly. A version records business identity and artifact identity; the Worker heartbeat separately records the runtime adapter and code fingerprint. Inference Workers can only serve versions already published by the Server. Training Workers can only claim TrainingRuns already created from immutable DatasetSnapshots. Successful training publishes a candidate version and never changes the Dataset selection automatically.

JSON naming follows ownership rather than implementation language: Worker-authored artifact documents (`prelabel` and `inference.json`) use `snake_case`; Server control-plane and review documents use `camelCase`. The Server performs the explicit translation when it promotes an artifact into a ModelVersion.

An image is its bytes. Its format is read from the bytes (JPEG, PNG, or TIFF), the same photograph uploaded twice, under any names, is one image, and one image can belong to several datasets and snapshots at once; the name it was added under belongs to each membership and is shown, never matched. An upload reports which memberships it created and which already existed. A dataset removal drops the membership and its review documents; the image row goes once nothing refers to it, and its bytes stay on disk until `bun run images:collect` (in `web/`) removes the bytes of images no row refers to, deciding each digest under the same lock uploads take. Because a digest names immutable content, image URLs (`/img/<digest>`) are cached indefinitely.

An image's state within a dataset follows from which rows exist for it there. Without a prelabel it is `pending`; a prelabel carrying an `error` is `failed`; a result is `prelabeled`; once a label exists, the label status applies and its source prelabel is frozen. Changing a Dataset's selected version makes its unlabelled images pending for that version.

Annotation documents marked `complete` are the canonical training data. Editing a completed annotation returns it to `in_progress`; excluded images are kept in review state but omitted from training and from the YOLO export (`dataset export-yolo`); a dataset pull mirrors all review state, exclusions included.

## Local recognition

Local commands read a pulled data root: `blobs/<xx>/<sha256>` holds image bytes shared by every dataset, and `datasets/<dataset>.json` is the dataset's export document with each image's digest, filename, split, prelabel, and label. Pull one from the workbench with the export credential:

```bash
export VITROFLOW_SERVER_URL=https://vitroflow.example.com
export VITROFLOW_EXPORT_TOKEN=<export-secret>
uv run vitroflow dataset pull --dataset fixtures --data-root data
```

Every local command verifies each blob it reads against its digest and refuses one that fails. A pull keeps the local blobs that verify, downloads the missing ones, repairs any blob that fails verification, and then replaces the dataset document in one rename, so a pull either mirrors the server exactly or leaves the previous copy untouched. Install the Python environment and recognize one image or a directory:

```bash
uv sync
uv run vitroflow recognize photos/ --output output/local-review
```

Each image produces a result JSON, an overlay, and a diagnostic image. The batch also produces `counts.csv`. A result document records the input `path` it was computed from and identifies the image itself by its content digest.

Pass a trained model or a pipeline configuration explicitly when needed:

```bash
uv run vitroflow recognize photos/ \
  --output output/review \
  --model output/models/candidate-seedness/model.json \
  --config config/pipeline.json
```

## Workbench and inference Worker

Start the annotation workbench for local development:

```bash
cd web
bun install
bun run dev
```

Uploading images to a dataset is all it takes to request prelabels. The Worker polls the authenticated API for pending images, downloads each source image, runs the same recognition core used by the local command, and uploads the resulting prelabel JSON:

```bash
export VITROFLOW_SERVER_URL=https://vitroflow.example.com
export VITROFLOW_INFERENCE_WORKER_TOKEN=<inference-secret>
uv run vitroflow-inference-worker \
  --model-version-id <dataset>.traditional-v1
```

Use `--model` and `--config` to configure the traditional adapter. The supplied `--model-version-id` must already exist on the Server and its registered artifact digest must match the adapter. A heartbeat verifies this deployment; it never creates a ModelVersion.

To serve a published YOLO version, install the YOLO dependency group. The Worker downloads and verifies the registered weights and inference settings over HTTP before it heartbeats:

```bash
uv sync --group yolo
uv run --group yolo vitroflow-inference-worker \
  --model-version-id <dataset>.<training-run> \
  --device mps
```

The Worker depends only on the common box-first prelabeler contract, so both implementations use the same review API. `--once` runs a single pass over the pending images and exits.

The inference protocol uses a dedicated credential:

| Call | Purpose |
|---|---|
| `POST api/inference/heartbeat` | verifies a published deployment and reports runtime state |
| `GET api/inference/pending?workerId=<id>` | images assigned to that exact artifact |
| `GET api/inference/images/<digest>` | source image bytes |
| `PUT api/inference/prelabels/<dataset>/<digest>?workerId=<id>` | versioned prelabel document |

Each pass heartbeats, fetches the pending list, then per image heartbeats, downloads, detects, and uploads. Successful documents contain the producer identity and canonical seed bounding boxes; implementation-specific warnings and traditional-only metrics or dish geometry use the generic quality/diagnostics boundary. A detection error becomes a failure document (`schema_version`, `image`, `producer`, `error`), the image shows as `failed`, and the pass continues. Persisted prelabels and annotations carry a schema version and are parsed against one contract. Prelabels are JSON only; rendered views belong to local recognition.

The Worker identifies itself by hostname, or by `--worker-id` / `VITROFLOW_INFERENCE_WORKER_ID`. The Status page lists each Worker with its presence, current image, and model.

Workbench configuration lives in the environment; `.env.example` lists every variable.

- `DATABASE_URL`: the Postgres connection. The workbench applies the SQL migrations in `web/drizzle/` on startup. `pglite://<dir>` runs an embedded Postgres in that directory for single-machine development; `pglite://` alone keeps it in memory.
- `VITROFLOW_DATA_ROOT`: the blob store (default: `../data` relative to `web/`).
- Schema changes: edit `web/src/db/schema.ts`, then generate the migration with `bun run db:generate`.

For a container deployment:

```bash
docker compose up --build
```

`compose.yaml` runs Postgres 17, mounts `./data` at `/data`, and serves port 3000. `VITROFLOW_PASSWORD` protects the workbench. `VITROFLOW_INFERENCE_WORKER_TOKEN` and `VITROFLOW_TRAINING_WORKER_TOKEN` are independent machine credentials for Workers. `VITROFLOW_EXPORT_TOKEN` is a developer/admin credential for `vitroflow dataset pull`; it is never given to a Worker. The workbench runs as a single replica; Workers scale independently because they only reach it over HTTP.

Build inference deployments with `Dockerfile.inference` and configure:

```env
VITROFLOW_SERVER_URL=https://vitroflow.example.com
VITROFLOW_INFERENCE_WORKER_TOKEN=<inference-secret>
VITROFLOW_INFERENCE_MODEL_VERSION_ID=<published-version-id>
VITROFLOW_INFERENCE_DEVICE=cuda:0
```

The container serves `/healthz` on the platform `PORT`. It needs no shared data volume; all inputs and outputs travel through authenticated HTTP.

## Training Worker

The dataset page's Train action creates a TrainingRun from the `complete` annotations; one run per model is active at a time. The Server freezes the reviewed annotations into a DatasetSnapshot that references images by digest, keeps train/validation assignments stable across later snapshots, and leases queued work to a dedicated Training Worker. Claim is reentrant for the Worker's active lease; the immutable snapshot is fetched as a separate resource. The Worker downloads and verifies each image, materializes YOLO data through the same canonical exporter used by local workflows, and trains through the Ultralytics Python API.

Every TrainingRun pins the base-weight digest, training configuration digest, and Ultralytics version. The Worker verifies all three before training. It then uploads `best.pt` and `inference.json` through one idempotent artifact endpoint. Only the Server publishes the resulting candidate ModelVersion; an interrupted `publishing` state is reconciled before the next claim, and publication never changes the Dataset selection automatically.

```bash
uv sync --group yolo
export VITROFLOW_SERVER_URL=https://vitroflow.example.com
export VITROFLOW_TRAINING_WORKER_TOKEN=<training-secret>
uv run --group yolo vitroflow-training-worker --device cuda:0
```

Build a remote training deployment with `Dockerfile.training`. Training and inference devices are intentionally independent; neither Worker requires the Server's filesystem.

## Prelabel workflow

The traditional prelabeler generates candidate centers and candidate-local evidence. Its candidate model combines a regularized global classifier with bounded local calibration. The adapter turns scale-aware deduplicated centers into the same canonical seed boxes that future YOLO prelabelers will emit.

Evaluate the current model on all complete annotations:

```bash
uv run vitroflow prelabel evaluate --data-root data --dataset fixtures
```

The report separates proposal recall from final detection precision and recall. Proposal recall measures whether candidate generation reaches each reviewed box; final metrics measure the corrections required after scoring and deduplication.

Train with leave-one-image-out selection of model form, regularization, and confidence threshold, then evaluate the resulting artifact:

```bash
uv run vitroflow prelabel train \
  --data-root data \
  --dataset fixtures \
  --output output/models/candidate-seedness

uv run vitroflow prelabel evaluate \
  --data-root data \
  --dataset fixtures \
  --model output/models/candidate-seedness/model.json \
  --config output/models/candidate-seedness/config.json
```

Training publishes `model.json`, its selected `config.json`, and `report.json` together in a new artifact directory. Selecting an artifact for recognition is explicit through `--model` and `--config`.

## YOLO dataset export

Export complete box annotations as a deterministic YOLO detection dataset:

```bash
uv run vitroflow dataset export-yolo \
  --data-root data \
  --dataset fixtures \
  --output output/datasets/seeds-v1 \
  --validation-fraction 0.2 \
  --seed 42
```

The export contains the source images named by digest, normalized YOLO labels, `dataset.yaml`, and a manifest recording digests, revisions, and train/validation assignments. An image keeps the stable split the server recorded for it in the dataset; only images without one are assigned locally from `--seed` and `--validation-fraction`. Training artifacts and dataset exports are published atomically to new directories.

## YOLO26 fine-tuning

Until complete human-reviewed labels are available, build a temporary dataset from
a dataset's prelabels. During this bootstrap phase they are treated as training
targets, so validation metrics measure agreement with the traditional algorithm
rather than final real-world accuracy. Failure documents are skipped. Pull the
dataset first so the prelabels are on disk:

```bash
uv run python scripts/build_yolo_prelabels.py \
  --dataset <dataset> \
  --data-root data \
  --output output/yolo/prelabels-smoke \
  --seed 42
```

Install the separate training dependencies and run the documented small-dataset
fine-tuning recipe through the Ultralytics Python API:

```bash
uv sync --group yolo

uv run --group yolo python scripts/train_yolo.py \
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
├── prelabelers/
│   ├── contract.py   Shared box-first runtime boundary
│   ├── documents.py  Strict persisted-document parser
│   ├── traditional.py Traditional-vision adapter
│   └── yolo.py       Validated Ultralytics inference adapter
├── yolo/
│   ├── dataset.py    Canonical reviewed-label export
│   ├── bootstrap.py  Prelabel bootstrap adapter
│   ├── runtime.py    Lazy Ultralytics runtime loading
│   └── training.py   Ultralytics training and validation
├── cli.py            Local workflows
├── inference_worker.py Remote prelabel execution
├── training_worker.py  Remote YOLO training execution
└── worker_runtime.py   Shared process health endpoint

web/
├── drizzle/          Generated SQL migrations
└── src/
    ├── db/           Drizzle schema and connection
    ├── datasets/     Dataset identity, image references, derived image states
    ├── models/       Logical Model and immutable ModelVersion contracts
    ├── detection/    Prelabel document contract
    ├── inference/    Runtime and inference heartbeat contracts
    ├── training/     DatasetSnapshot and TrainingRun contracts
    ├── annotation/   Box annotation domain
    ├── components/   Review workbench UI
    ├── hooks/        Annotation persistence and history
    ├── routes/       Pages, image delivery, and Worker API
    └── server/       Control plane, leases, artifacts, and Worker presence
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

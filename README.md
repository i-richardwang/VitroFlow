# VitroFlow

VitroFlow reads petri-dish photographs—today a seed count, tomorrow a germination rate—and turns the boxes a person corrects into better detectors. Experiments are the work: dishes photographed on successive occasions and read by one model version. The Web workbench is the control plane; independent inference and training Workers may run on different machines.

## System workflow

```text
Photograph the dishes of an Experiment, round after round
          ↓
Inference Worker detects every photograph with the Experiment's ModelVersion
          ↓
Reviewer corrects the boxes of any photograph, from the Experiment or a Dataset
          ↓
Reviewed photographs are added to a Dataset; the Server freezes a DatasetSnapshot and queues a TrainingRun
          ↓
Training Worker fine-tunes and validates YOLO26
          ↓
Server publishes a candidate ModelVersion
```

Postgres holds every record the stages exchange; one S3-compatible bucket holds only binary content the records reference:

| Table                                                                        | Owner            | Contents                                                                                            |
| ---------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| `models`, `model_versions`                                                   | Server           | the tasks the workbench reads (one logical Model each) and their immutable executable ModelVersions |
| `images`                                                                     | Server           | one row per canonical photograph, identified by the SHA-256 of its bytes                            |
| `datasets`, `dataset_images`                                                 | Server           | a training set for one Model: experiment photographs with their stable train/validation split       |
| `detections`, `detection_failures`                                           | Inference Worker | the canonical result for one image/version pair; its most recent execution failure                  |
| `labels`                                                                     | Reviewer         | the reviewed boxes of one image for one Model, with a revision counter                              |
| `experiments`, `experiment_dishes`, `experiment_rounds`, `experiment_photos` | Server           | readings of the same dishes on successive occasions, fixed to one ModelVersion                      |
| `inference_workers`, `training_workers`                                      | Workers          | latest heartbeat per process                                                                        |
| `dataset_snapshots`, `dataset_snapshot_images`                               | Server           | immutable sets of reviewed training inputs                                                          |
| `training_runs`                                                              | Server           | leased training state machines; a partial unique index allows one active run per model              |
| `training_epochs`                                                            | Training Worker  | one row per finished epoch and attempt: losses, precision, recall, mAP, fitness, learning rate      |

```text
<bucket>/
├── images/<xx>/<sha256>                              immutable canonical AVIF photographs, addressed by content
└── model-weights/<run-id>/<attempt>/<sha256>          immutable weights owned by one training attempt
```

Objects are immutable: every write is conditional and can only create a missing key; repeating identical content is idempotent and different content can never replace it. A Training Worker uploads weights under its TrainingRun attempt before one short database transaction registers the resulting ModelVersion and completes the run. That attempt is recorded in the version source and fenced again when the publication commits. The Worker-authored manifest is validated and normalized into the version rather than persisted as a second blob. The Server deployment runs one Maintenance process that collects unreferenced objects every hour, independently of HTTP traffic. `bun run blobs:collect` (in `web/`) performs the same maintenance once: it expires unclaimed Image rows, sweeps image objects with no committed row, and removes weight objects owned by neither the current running attempt nor its published version; each decision uses the same database lock as the corresponding writer.

A Model is a task: the classes it finds in a photograph and the readings an experiment takes from them. A reading is a declared reduction of the instances found—a count of some classes, or the proportion of some classes among others—so a model that separates germinated seeds from seeds supports a germination rate with no change to the workbench, and the grid, the dish page, and the review inspector all read the same definitions. Every deployment starts with the builtin `seed-detector` whose first version is the traditional detector shipped with the package. Training publishes further versions of the same Model. A Dataset is a training set for one Model; several datasets may train the same Model. The Training page lists every version with its validation metrics, and opens each TrainingRun on its own page with per-epoch loss and metric curves, the parameters it fixed, and the version it published. A version records business identity and artifact identity; the Worker heartbeat separately records the runtime adapter and code fingerprint. Inference Workers can only serve versions already published by the Server. Training Workers can only claim TrainingRuns already created from immutable DatasetSnapshots. Successful training publishes a candidate version; experiments started afterwards preselect it, and experiments already running keep theirs.

JSON naming follows ownership rather than implementation language: Worker-authored artifact documents (detection outcomes and `inference.json`) use `snake_case`; Server control-plane and review documents use `camelCase`. The Server performs the explicit translation when it promotes an artifact into a ModelVersion.

An uploaded file is a source, not yet an image. The Server accepts one JPEG, PNG, or TIFF photograph up to 64 MiB and 40 megapixels, applies its orientation, converts its colours to sRGB, composites transparency onto white, and encodes one opaque AVIF. Those canonical bytes define the image digest, pixel dimensions, browser view, inference input, and training input. Repeating the same source therefore produces the same image under any filename, while the original filename belongs to the round that photographed it and is shown, never matched. Photographs enter the system only through an experiment round: the Web client posts each source to `/api/images` as soon as it is picked, one request per photograph, and submitting the round posts the resulting digests and filenames in one atomic request. References are what keep an image alive: experiment photographs, dataset memberships, snapshot rows, and reviews. Collection forgets an unreferenced Image row once its bytes last arrived more than a day ago; a separate Blob sweep then removes every immutable image object no committed row roots, including objects left by interrupted stores. Because a digest names immutable content, image URLs (`/img/<digest>`) are cached indefinitely.

A detection is addressed by its canonical business key, the image and the ModelVersion, and belongs to neither dataset nor experiment: every consumer that needs that pair reads the same row, and it is written once. Resubmitting an identical result is accepted; a different result for the same pair is refused as an inconsistency between Workers. A failure means execution did not produce a valid result; zero detected instances is a successful detection. Failure state is replaceable by the next attempt, removable by an explicit retry, and always outranked by a detection arriving later. Both success and failure documents bind their producer's artifact digest to the registered ModelVersion in the database.

An Experiment has a server-generated identity and a user-facing name, and reads the same dishes on successive occasions with one ModelVersion chosen at creation; versions of every Model are offered newest first, so a fresh deployment reads with the traditional baseline and a deployment that has trained preselects its latest version. There is no operation that changes the version, so every reading in the experiment remains comparable. The first round of photographs names the dishes: the filename stem is the dish label, `A3.jpg` in every round is dish `A3`, and the roster keeps natural order. A round has its own opaque identity, descriptive label, and explicit capture time; grids order rounds by capture time rather than upload order. Each round is one atomic upload and may photograph any subset of the established roster. A request that names an unknown dish, names one dish twice, repeats a round label, or reuses a photograph already present anywhere in the experiment is refused explicitly. The grid is dishes by rounds and shows the Model's primary reading in each cell—`pending` or `failed` until the detection exists, and the reviewer's reading in place of the version's once a review of that photograph for the experiment's Model is complete. A dish is the page: `/experiments/<experiment>/<dish>` shows the dish's photograph for one round (`?round=`, newest by default) in the same pan-and-zoom workbench the review uses. The inspector reads that photograph; the navbar opens its review or adds it to a Dataset. The experiment page adds every photograph in the experiment to a Dataset.

A review belongs to the image and the Model, not to the place it was opened from: correcting a photograph from an experiment and correcting it from a dataset edit one document, and a photograph reviewed for two Models has two. The review workbench lives at `/review/<model>/<digest>` and starts from the detection whose reading the reviewer saw. An image's state within a dataset is the state of its review for the dataset's Model: `unreviewed` until one starts, then `in_progress`, `complete`, or `excluded`; the dataset shows the detection the review started from, or the Model's newest detection of the image until then. Removing an image from a dataset removes the membership only.

Annotation documents marked `complete` are the canonical training data. Editing a completed annotation returns it to `in_progress`; excluded images are kept in review state but omitted from training and from the YOLO export (`dataset export-yolo`); a dataset pull mirrors all review state, exclusions included.

## Local recognition

Local commands read a pulled data root: `blobs/<xx>/<sha256>` holds canonical AVIF bytes shared by every dataset, and `datasets/<dataset>.json` records each image's digest, dimensions, filename, split, detection, and label. Install the environment and pull one Dataset from the workbench with the export credential:

```bash
uv sync
export VITROFLOW_SERVER_URL=https://vitroflow.example.com
export VITROFLOW_EXPORT_TOKEN=<export-secret>
uv run vitroflow dataset pull --dataset fixtures --data-root data
```

Every local command verifies each blob it reads against its digest and refuses one that fails. A pull keeps the local blobs that verify, downloads the missing ones, repairs any blob that fails verification, and then replaces the dataset document in one rename, so a pull either mirrors the Server exactly or leaves the previous copy untouched. Recognition consumes the Dataset as stored rather than accepting a second local-image ingress path:

```bash
uv run vitroflow recognize \
  --dataset fixtures \
  --data-root data \
  --output output/local-review
```

Each digest produces a result JSON, an overlay, and a diagnostic image. The Dataset batch also produces `counts.csv`; every result identifies its verified blob path and content digest.

Pass a trained model or a pipeline configuration explicitly when needed:

```bash
uv run vitroflow recognize \
  --dataset fixtures \
  --data-root data \
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

Adding a round to an experiment is all it takes to request its detections. A named Inference Worker profile is a runtime, not a deployment: it advertises the adapters it can execute (the traditional baseline always, Ultralytics when installed), and the Server derives outstanding image/version pairs from the photographs experiments hold under the versions they read with, each pair once however many experiments share it. Datasets create no demand: their photographs already carry the detections their reviews start from. The Worker loads versions on demand, holding one in memory at a time and caching downloaded YOLO weights under its work directory after verifying their digests; the traditional baseline is verified against the artifact bundled with the package. The built-in baseline and every published YOLO version implement the same box-first detection contract and therefore use the same upload API.

The inference protocol uses a dedicated credential:

| Call                                                         | Purpose                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| `POST api/inference/heartbeat`                               | advertises runtime capabilities and reports loaded/current work |
| `GET api/inference/pending?workerId=<id>`                    | compatible assignments with versioned execution manifests       |
| `GET api/inference/images/<digest>`                          | canonical image bytes                                           |
| `PUT api/inference/results/<version>/<digest>?workerId=<id>` | the outcome for that pair: a detection or a failure document    |

On each polling interval the Worker heartbeats, fetches one snapshot of pending assignments, then per version loads the model and per image heartbeats, downloads, detects, and uploads. A version that fails to load is skipped until the next interval so the other assignments proceed without creating a hot retry loop. Invalid YOLO cache entries are discarded and rebuilt from verified Server bytes. Successful documents contain the producer identity and canonical classified bounding boxes; implementation-specific warnings and traditional-only metrics or dish geometry use the generic quality/diagnostics boundary. A detection error becomes a failure document (`schema_version`, `image`, `producer`, `error`), the image shows as `failed`, and the pass continues. The Server verifies that the path, the producer, the registered artifact, the declared classes, and the Worker's advertised runtimes agree before recording either document; a detection that differs from the one already recorded for the pair is refused with 409, which the Worker surfaces as an error rather than a stale assignment. Persisted detections and annotations carry a schema version and are parsed against one contract. Detections are JSON only; rendered views belong to local recognition.

The Status page lists each Worker profile with its presence, current image, loaded version, and runtimes.

### Native Worker services on macOS

Inference and training machines do not need a VitroFlow Server deployment. Install the Python package once on each machine, create one named profile per Worker process, and let macOS `launchd` supervise the foreground process:

```bash
# From a source checkout; a published release uses: uv tool install 'vitroflow[yolo]'
uv tool install '.[yolo]'

vitroflow worker setup inference mac-inference \
  --server https://vitroflow.example.com \
  --device mps

vitroflow worker setup training mac-mps \
  --server https://vitroflow.example.com \
  --device mps
```

Setup always prompts for the role-specific credential without echoing it, so the token never enters shell history or the LaunchAgent. It validates Server authentication and role, the available runtimes, and the accelerator before it commits the profile and installs the LaunchAgent. Both roles share one profile shape. One inference profile per machine serves every dataset; a second one on the same machine would receive the same assignments and repeat its work.

Setup refuses to replace an existing profile unless `--force` is supplied; a forced setup validates the replacement before restarting its service.

```bash
vitroflow worker list
vitroflow worker status mac-mps
vitroflow worker doctor mac-mps
vitroflow worker logs mac-mps --follow
vitroflow worker restart mac-mps
vitroflow worker stop mac-mps
```

Profile state lives under `~/.vitroflow/profiles/<profile>/`. `config.toml` is atomically written with mode `0600`, `work/` contains disposable downloads and artifacts, `status.json` records the local process state, and `worker.log` rotates at 5 MiB with three backups. The LaunchAgent contains no credential; it only invokes `vitroflow worker run <profile>`. `VITROFLOW_HOME` may point these files elsewhere for managed installations or tests.

Stopping a profile is cooperative: inference finishes its current image, while training and validation stop at the next batch boundary. An interrupted TrainingRun is not published or marked failed; its lease remains recoverable by a Training Worker.

Workbench configuration lives in the environment; `.env.example` lists every variable.

- `DATABASE_URL`: the Postgres connection. The workbench applies the SQL migrations in `web/drizzle/` on startup. `pglite://<dir>` runs an embedded Postgres in that directory for single-machine development; `pglite://` alone keeps it in memory.
- `VITROFLOW_BLOB_ENDPOINT` and `VITROFLOW_BLOB_BUCKET`: the HTTP(S) endpoint and bucket holding image and model bytes. The AWS SDK uses its standard credential and region provider chain, including `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION`. `memory://` as the endpoint keeps blobs in the server process for tests. Any S3-compatible store works; Compose runs RustFS.
- Schema changes: edit `web/src/db/schema.ts`, then generate the migration with `bun run db:generate`.
- `bun test` (in `web/`) runs against an in-process database and blob store and needs nothing running. The BlobStore contract can also run against RustFS by setting `VITROFLOW_TEST_S3_ENDPOINT` and `VITROFLOW_TEST_S3_BUCKET` together with the standard AWS credentials; `docker compose up -d rustfs bucket` serves one locally.

For a Server deployment:

```bash
docker compose up --build
```

Set `HEROUI_KEY` in the build environment; Compose passes it to BuildKit as a secret, and neither the image configuration nor a build layer retains it. `compose.yaml` runs Postgres 17 and RustFS, creates the bucket before the workbench starts, and serves port 3000. The same Web image also runs one private Maintenance process; it waits for the workbench health check, then collects unreferenced image and model-weight objects every hour. `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY`, and `BLOB_BUCKET` name the bucket these services share. `VITROFLOW_PASSWORD` protects the workbench. `VITROFLOW_INFERENCE_WORKER_TOKEN` and `VITROFLOW_TRAINING_WORKER_TOKEN` are independent machine credentials for Workers. `VITROFLOW_EXPORT_TOKEN` is a developer/admin credential for `vitroflow dataset pull`; it is never given to a Worker. The workbench and Maintenance process each run as a single replica; Workers scale independently because they only reach the workbench over HTTP.

The same Compose deployment can be used as a local acceptance Server with real Worker tokens. Run the Workers natively against `http://localhost:3000` to exercise authentication and the complete control-plane protocol while retaining macOS MPS acceleration.

## Training Worker

The training page's Train action creates a TrainingRun from the `complete` annotations with the recipe's parameters, of which epochs, image size, batch, patience, and learning rate can be changed per run; one run per model is active at a time. The Server freezes the reviewed annotations into a DatasetSnapshot that references images by digest, keeps train/validation assignments stable across later snapshots, and leases queued work to a dedicated Training Worker. Claim is reentrant for the Worker's active lease; the immutable snapshot is fetched as a separate resource. The Worker downloads and verifies each image, materializes YOLO data through the same canonical exporter used by local workflows, and trains through the Ultralytics Python API.

Every TrainingRun pins the base-weight digest, the complete set of Ultralytics training arguments, and the Ultralytics version; the Server validates the Web contract, while one Python recipe parser is shared by the local training entry point, Training Worker, and inference model loader. The published ModelVersion records that identity verbatim. The Worker advances through `preparing → training → validating`; the Server owns the phase order and maps completed epochs onto one monotonic overall progress scale. After each saved epoch's validation pass the Worker posts framework-neutral box, classification, and regression losses together with precision, recall, mAP50, mAP50-95, fitness, and learning rate. The adapter maps either Ultralytics `l1_loss` or `dfl_loss` into regression loss. Lease renewal is a separate operation that cannot rewrite phase or progress, and it covers snapshot preparation, training, and final best-weight validation. A stable Worker ID identifies the machine profile, while a fresh process-session ID fences ownership after every daemon restart; the new process can reclaim its unfinished run immediately as a new attempt, and the previous process can no longer write. Worker protocol responses distinguish malformed requests (`400`), missing runs (`404`), ownership or state conflicts (`409`), invalid artifacts (`422`), and unexpected Server failures (`500`). An unexpected execution error marks the run failed; an intentional shutdown or lost lease remains recoverable. A reclaimed run keeps the earlier attempt's epochs in its history. The Worker uploads `best.pt` and `inference.json` through one idempotent artifact endpoint. The Server stores only the immutable weights owned by that attempt, normalizes the manifest into a candidate ModelVersion, and completes the run in one database transaction; experiments already running keep the version they started with.

Training uses the native profile configured above; neither Worker requires the Server's filesystem. The supported service host is macOS `launchd`, which preserves native MPS access. A Linux/CUDA deployment should add its own host adapter when it is actually required instead of introducing a second Worker execution interface now.

## Traditional detector development

The traditional detector generates candidate centers and candidate-local evidence. Its candidate model combines a regularized global classifier with bounded local calibration. It is explicitly seed-only; its adapter and the multiclass Ultralytics adapter both emit the same canonical classified-box contract.

Evaluate the current model on all complete annotations:

```bash
uv run vitroflow traditional evaluate --data-root data --dataset fixtures
```

The report separates proposal recall from final detection precision and recall. Proposal recall measures whether candidate generation reaches each reviewed box; final metrics measure the corrections required after scoring and deduplication.

Train with leave-one-image-out selection of model form, regularization, and confidence threshold, then evaluate the resulting artifact:

```bash
uv run vitroflow traditional train \
  --data-root data \
  --dataset fixtures \
  --output output/models/candidate-seedness

uv run vitroflow traditional evaluate \
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

The export contains the canonical AVIF images named by digest, normalized YOLO labels, `dataset.yaml`, and a manifest recording digests, revisions, and train/validation assignments. An image keeps the stable split the Server recorded for it in the Dataset; only images without one are assigned locally from `--seed` and `--validation-fraction`. Training artifacts and dataset exports are published atomically to new directories.

## YOLO26 fine-tuning

Until complete human-reviewed labels are available, build a temporary dataset from
a dataset's detections. During this bootstrap phase they are treated as training
targets, so validation metrics measure agreement with the traditional algorithm
rather than final real-world accuracy. Failure documents are skipped. Pull the
dataset first so the detections are on disk:

```bash
uv run python scripts/build_yolo_detections.py \
  --dataset <dataset> \
  --data-root data \
  --output output/yolo/detections-smoke \
  --seed 42
```

Install the separate training dependencies and run the checked-in small-dataset
recipe through the Ultralytics Python API:

```bash
uv sync --extra yolo

uv run python scripts/train_yolo.py \
  --data output/yolo/detections-smoke/dataset.yaml \
  --output output/yolo/train-seed-small \
  --device mps
```

`configs/yolo26/seed-small.recipe.json` is the single training recipe: base
weights with their digest, every Ultralytics training argument the run fixes, and
the Ultralytics version. The Web workbench offers the same recipe as defaults, and
`--epochs`, `--imgsz`, and `--batch` override it locally. The recipe follows Ultralytics' YOLO26 guidance for datasets with fewer
than 1,000 images: AdamW at `lr0=0.001`, 50 epochs, and early stopping with
`patience=20`. Mosaic is disabled using the guide's very-small-dataset fallback:
each dish already contains hundreds of tiny targets, and combining four dishes
made MPS target assignment pathologically expensive. The recipe deliberately
leaves Ultralytics' gradient accumulation and three-epoch warmup unchanged. It uses
`imgsz=1536` because a seed box is only about five pixels wide at the default 640;
the larger input keeps it near twelve pixels wide, following Ultralytics' guidance
to increase resolution for small-object datasets. The M5 Pro recipe pairs that
resolution with `batch=4` to bound the pixel load per step on its 24 GB unified
memory while prioritizing object visibility. Both values remain explicit run
parameters for machines with different training-memory capacity.

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
├── traditional_training/
│   ├── data.py       Candidate labels from reviewed boxes
│   ├── evaluation.py Proposal and detection metrics
│   └── training.py   Model and threshold selection
├── detectors/
│   ├── contract.py   Shared box-first runtime boundary
│   ├── documents.py  Strict persisted-document parser
│   ├── traditional.py Traditional-vision adapter
│   └── ultralytics.py Validated Ultralytics inference adapter
├── yolo/
│   ├── dataset.py    Canonical reviewed-label export
│   ├── bootstrap.py  Detection bootstrap adapter
│   ├── runtime.py    Lazy Ultralytics runtime loading
│   └── training.py   Ultralytics training and validation
├── cli.py            Local workflows
├── worker_command.py Native Worker management commands
├── inference_worker.py Inference protocol and execution
├── inference_models.py On-demand model loading and artifact cache
├── training_worker.py  Training protocol, epoch reporting, and execution
├── worker_profiles.py  Strict per-process native configuration
├── worker_host.py      Profile preflight, execution, status, and logs
├── worker_launchd.py   macOS LaunchAgent lifecycle
└── worker_runtime.py   Process signals and logging

web/
├── drizzle/          Generated SQL migrations
└── src/
    ├── db/           Drizzle schema and connection
    ├── datasets/     Dataset identity, image references, review-derived image states
    ├── models/       Logical Model and immutable ModelVersion contracts
    ├── detection/    Detection outcome contract
    ├── experiments/  Experiment, dish label, and round contracts
    ├── inference/    Runtime and inference heartbeat contracts
    ├── training/     DatasetSnapshot, TrainingRun, parameter, and epoch contracts
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

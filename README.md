# VitroFlow

VitroFlow turns repeated culture images into comparable derived metrics and reviewed detector training data. Treatments define the conditions being compared, observation units provide independent replicates, observations follow those units over time, and one immutable model version analyzes every image in an experiment.

The system has three independently deployed parts:

- the Web workbench owns experiments, datasets, review state, training runs, and worker protocols;
- inference Workers execute published model versions;
- training Workers train immutable dataset snapshots and publish candidate model versions.

## Data flow

```text
Experimental design
  -> observation
  -> canonical image
  -> inference outcome
  -> reviewer correction
  -> dataset membership
  -> immutable dataset snapshot
  -> training run
  -> candidate model version
```

Postgres is the source of truth for records. One S3-compatible bucket stores immutable image and model-weight bytes referenced by those records.

| Records                                                                                                                                                         | Purpose                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `models`, `model_versions`                                                                                                                                      | Detector tasks, class definitions, derived metrics, runtime manifests, and immutable artifacts |
| `images`                                                                                                                                                        | Canonical images addressed by the SHA-256 digest of normalized AVIF bytes                      |
| `experiments`, `experiment_treatments`, `experiment_observation_units`, `experiment_culture_events`, `experiment_observations`, `experiment_observation_images` | Experimental design and repeated observations under one fixed model version                    |
| `inference_outcomes`                                                                                                                                            | The single success-or-failure outcome for an image and model-version pair                      |
| `annotations`                                                                                                                                                   | Versioned reviewer annotations for an image and model                                          |
| `datasets`, `dataset_images`                                                                                                                                    | Reviewed training collections with stable train/validation assignments                         |
| `dataset_snapshots`, `dataset_snapshot_images`                                                                                                                  | Immutable training inputs                                                                      |
| `training_runs`, `training_epochs`                                                                                                                              | Leased training state and per-attempt epoch metrics                                            |
| `inference_workers`, `training_workers`                                                                                                                         | Worker capabilities, presence, and current activity                                            |

The object layout is:

```text
<bucket>/
├── images/<xx>/<sha256>
└── model-weights/<training-run>/<attempt>/<sha256>
```

Object creation is conditional. Identical writes are idempotent; content at an existing key is never replaced. The maintenance process removes unreferenced images and model weights using the same database locking boundaries as their writers.

## Domain rules

A Model defines the classes detected in an image and the derived metrics computed from them. The built-in `seed-detector` begins with the bundled traditional model; training publishes additional versions of the same Model.

An Experiment records the plant material, explant type, shared base medium, notebook notes, and inoculation date, and selects one ModelVersion when it is created. That version never changes, so derived metrics remain comparable across observations.

A Treatment names one condition the experiment compares. It may record that condition as a factor, level, and unit, written as applied; a treatment described in prose alone has no factor. Light, temperature, and other protocol that every treatment shares belong on the experiment. The factor and note can be filled in at any point.

An ObservationUnit is one independent experimental unit and exists before any image does. Its code is unique within the experiment. Creating a treatment may generate `T1-1` through `T1-n`, or name the condition first and add dishes later. Units can also be added by the codes already on the dishes, then assigned. Correcting a code preserves the unit identity and every record attached to it. Objects within a unit are measured in each observation image.

Observation dates may be planned before every unit is assigned. Treatments, observation units, assignments, protocol fields, and observation dates stay correctable so a miswritten label can be fixed. An observation unit with images or culture events cannot be deleted, because those records belong to the physical unit. An inoculation date cannot move past an existing observation. An observation with an image or culture event cannot be deleted. An experiment with images or culture events cannot be hard-deleted.

A CultureEvent records contamination, nonviability, discard, harvest, or a missing unit against the observation where it was identified. Discarded, harvested, and missing are terminal events: the unit is absent from every later observation and analysis denominator, and only one terminal event may be active for a unit. Analysis inclusion remains a separate decision with an event-specific default, because a nonviable unit is a result rather than a loss. Events are never overwritten; an erroneous event is voided with a correction reason and remains visible in the record. Treatment rows show the observation-unit mean, sample standard deviation, and `n` over eligible independent units.

An Observation is one occasion, dated by the day it happened and named by the days since inoculation. It cannot precede inoculation. An experiment is observed once a day at most, and observations are ordered by that day.

Observation images are assigned to the units they show, one per observation unit per observation. A source filename is retained for traceability but is not an identifier; it provides an initial code suggestion that the operator confirms. An image assigned to the wrong cell can be reassigned or unassigned without changing the canonical image, its inference outcome, or its annotation.

An uploaded JPEG, PNG, or TIFF is normalized to an oriented, opaque sRGB AVIF. Those bytes determine the image digest, dimensions, browser view, inference input, and training input.

`inference_outcomes` has one row per image and ModelVersion. A succeeded outcome contains classified boxes, including the valid zero-box case, and is immutable. A failed outcome contains the execution error and may be replaced through the explicit retry protocol; a conflicting successful result is rejected.

An annotation belongs to an image and Model, independent of the experiment or dataset from which it was opened. Only `complete` annotations enter dataset snapshots and YOLO exports. Editing a complete annotation returns it to `in_progress`; `excluded` annotations remain recorded but are not training inputs.

## Scope

The current workbench covers one stable culture stage per Experiment, one standardized image per observation unit and observation, and derived metrics under one fixed detector version. Derived metrics are per-image class counts or proportions within the same image; rates that require a separately recorded baseline population are outside the current scope. Objects detected within an observation unit are subsamples, not independent biological replicates. A physical Petri-dish boundary remains an image-analysis diagnostic rather than the identity of the experimental unit.

## Source development

Requirements are Python 3.11+, [uv](https://docs.astral.sh/uv/), Bun 1.4.0, and Docker for the local Postgres and S3-compatible services.

Install locked dependencies and start storage:

```bash
uv sync --all-extras --group dev --locked
cd web && bun install --frozen-lockfile && cd ..

cp web/.env.example web/.env
docker compose up -d postgres rustfs
docker compose run --rm bucket
```

Start the workbench:

```bash
cd web
bun run dev
```

The workbench applies the SQL migrations in `web/drizzle/` when it starts. Its default source-development configuration connects to Postgres and RustFS on localhost.

## Workers

Workers communicate only with the workbench HTTP API. Each native Worker profile has a stable worker ID, a fresh process-session ID, role-specific credentials, runtime capabilities, and a private work directory.

On macOS, install the package and configure `launchd` services:

```bash
uv tool install '.[yolo]'

vitroflow worker setup inference mac-inference \
  --server http://localhost:3000 \
  --device mps

vitroflow worker setup training mac-training \
  --server http://localhost:3000 \
  --device mps
```

Setup validates authentication, runtime imports, and the selected device before saving the profile. The token is prompted without echo and is stored in `~/.vitroflow/profiles/<profile>/config.toml` with mode `0600`; LaunchAgent files contain no credentials.

Operational commands are:

```bash
vitroflow worker list
vitroflow worker status mac-training
vitroflow worker doctor mac-training
vitroflow worker logs mac-training --follow
vitroflow worker restart mac-training
vitroflow worker stop mac-training
```

Inference Workers advertise the traditional runtime and, when installed and importable, the pinned Ultralytics runtime. They download canonical images and verified model artifacts, execute one pending image/version pair, and upload a succeeded or failed outcome.

Training Workers claim a queued run, download its immutable snapshot, materialize the canonical YOLO dataset, and advance through `preparing`, `training`, and `validating`. Every claim is fenced by worker ID, session ID, lease, and attempt. Completed epochs report losses, precision, recall, mAP50, mAP50-95, fitness, and learning rate. Publication registers verified `best.pt` bytes and their inference manifest as one candidate ModelVersion.

## Local dataset workflows

Pull one workbench Dataset with the export credential:

```bash
export VITROFLOW_SERVER_URL=http://localhost:3000
export VITROFLOW_EXPORT_TOKEN=<export-token>

uv run vitroflow dataset pull \
  --dataset fixtures \
  --data-root data
```

The local layout shares content-addressed blobs across datasets:

```text
data/
├── blobs/<xx>/<sha256>
└── datasets/<dataset>.json
```

Every command verifies blob digests before reading them. Run the bundled traditional detector over the pulled dataset:

```bash
uv run vitroflow recognize \
  --dataset fixtures \
  --data-root data \
  --output output/recognition
```

Evaluate or train its candidate scorer from complete annotations:

```bash
uv run vitroflow traditional evaluate \
  --dataset fixtures \
  --data-root data

uv run vitroflow traditional train \
  --dataset fixtures \
  --data-root data \
  --output output/models/traditional-candidate
```

Export complete human-reviewed annotations as a deterministic YOLO dataset:

```bash
uv run vitroflow dataset export-yolo \
  --dataset fixtures \
  --data-root data \
  --output output/datasets/fixtures-yolo \
  --validation-fraction 0.2 \
  --seed 42
```

Fine-tune with the same pinned recipe and adapter used by the Training Worker:

```bash
uv run python scripts/train_yolo.py \
  --data output/datasets/fixtures-yolo/dataset.yaml \
  --output output/models/yolo-candidate \
  --device mps
```

`configs/yolo26/seed-small.recipe.json` fixes the base-weight digest, Ultralytics version, and training arguments. `--epochs`, `--imgsz`, and `--batch` provide explicit local overrides.

## Deployment

Create the Compose environment and replace every credential before starting the deployment:

```bash
cp .env.example .env
docker compose up --build -d
```

Compose runs the workbench, maintenance process, Postgres 17.11, RustFS, and the one-shot bucket initializer. It exposes the workbench on port 3000 and RustFS on ports 9000 and 9001. Services restart unless stopped.

`HEROUI_KEY` is passed to the Web build through a BuildKit secret. The resulting image and build layers do not retain it. The inference, training, and export tokens are distinct credentials and should not be shared between roles.

The root `.env.example` defines only Compose inputs and immutable container manifests. `web/.env.example` defines the workbench environment for source development. Registry mirrors can replace the three image values without changing the Compose file.

## Verification

Run the complete deterministic gate from the repository root:

```bash
make check
```

It runs Ruff, Python formatting, Pyright, Python tests, Prettier, TypeScript, Web tests, and the production Web build.

Build the pinned production image with the private component credential:

```bash
make check-image HEROUI_KEY="$HEROUI_KEY"
```

The reference-image regression suite uses the checksum manifest in `tests/fixtures/reference-images.json`. Point it at the matching private corpus:

```bash
make check-reference REFERENCE_IMAGE_DIR=/absolute/path/to/reference-images
```

Run the BlobStore contract against an actual S3-compatible endpoint:

```bash
export AWS_ACCESS_KEY_ID=vitroflow
export AWS_SECRET_ACCESS_KEY=vitroflow
export AWS_REGION=us-east-1
export VITROFLOW_TEST_S3_ENDPOINT=http://localhost:9000
export VITROFLOW_TEST_S3_BUCKET=vitroflow

make check-s3
```

CI runs `make check`, builds the production image with the configured `HEROUI_KEY`, verifies the database invariants on PostgreSQL, and runs the S3 contract against RustFS. The reference-image gate is reproducible from its digest manifest and runs wherever the private corpus is provisioned.

## Repository layout

```text
configs/                 detector and training recipe manifests
scripts/train_yolo.py    reviewed local YOLO training entry point
src/vitroflow/           Python CLI, recognition, datasets, and Workers
tests/                   Python unit, contract, and reference tests
web/                     React workbench, server, database, and Web tests
compose.yaml             production-shaped local deployment
Dockerfile.web           pinned Web image build
Makefile                 repository verification gates
```

VitroFlow is licensed under the [MIT License](LICENSE).

# VitroFlow

The source layout and dependency boundaries are documented in [docs/architecture.md](docs/architecture.md); server transaction and concurrency rules are in [docs/backend-architecture.md](docs/backend-architecture.md).

VitroFlow turns repeated culture images into comparable readings and reviewed detector training data. Treatments define the conditions being compared, units provide independent replicates, observations follow those units over time, and each observation reads its images with one immutable model version. How an image becomes a count and a rate is defined in [docs/readings.md](docs/readings.md).

The application has two independently deployed parts:

- the Web workbench owns experiments, datasets, review state, training runs, and worker protocols;
- Workers execute published model versions and, when they carry the Ultralytics runtime, train immutable dataset snapshots and publish candidate model versions.

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

| Records                                                                                                                                             | Purpose                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `models`, `model_versions`                                                                                                                          | Detector tasks, class definitions, runtime manifests, and immutable artifacts         |
| `images`                                                                                                                                            | Canonical images addressed by the SHA-256 digest of normalized AVIF bytes             |
| `experiments`, `experiment_treatments`, `experiment_units`, `experiment_culture_events`, `experiment_observations`, `experiment_observation_images` | Experimental design and repeated observations, each read with one fixed model version |
| `inference_outcomes`                                                                                                                                | The single success-or-failure outcome for an image and model-version pair             |
| `annotations`                                                                                                                                       | Current reviewer annotations for an image and model                                   |
| `datasets`, `dataset_images`                                                                                                                        | Reviewed training collections with stable train/validation assignments                |
| `dataset_snapshots`, `dataset_snapshot_images`                                                                                                      | Immutable training inputs                                                             |
| `training_runs`, `training_epochs`                                                                                                                  | Leased training state and per-attempt epoch metrics                                   |
| `workers`, `inference_jobs`                                                                                                                         | Worker sessions with their capabilities and presence, and leased inference jobs       |

The object layout is:

```text
<bucket>/
├── images/<xx>/<sha256>
└── model-weights/<training-run>/<attempt>/<sha256>
```

Object creation is conditional. Identical writes are idempotent; content at an existing key is never replaced. The maintenance process removes unreferenced images and model weights using the same database locking boundaries as their writers.

## Domain rules

A Model defines the classes detected in an image, and nothing more; what an experiment computes from them belongs to the experiment. The built-in `seed-detector` begins with the bundled traditional model; training publishes additional versions of the same Model.

An Experiment's name is unique across the workbench, compared without regard to case. It records the plant material, explant type, shared base medium, notebook notes, and inoculation date.

A Treatment names one condition the experiment compares. It may record that condition as a factor, level, and unit, written as applied; a treatment described in prose alone has no factor. Light, temperature, and other protocol that every treatment shares belong on the experiment. The factor and note can be filled in at any point.

A Unit is one independent experimental unit, the vessel a treatment is applied to, and exists before any image does. Every unit replicates exactly one treatment: an experiment is created with its design, at least one treatment laid out in replicates coded `T1-1` through `T1-n`, and a treatment can gain replicates later. Its code is unique within the experiment. Correcting a code, or moving a unit to the treatment it actually received, preserves the unit identity and every record attached to it. Objects within a unit are measured in each observation image.

An Observation is one day the units were photographed, and it reads those images with one ModelVersion: seeds on the day of sowing, germination once shoots can show. The grid names the model in the column header when the days do not all read with the same one, so values in one column are comparable while columns may read different things. A new observation starts from what the previous one read. Changing an observation's version loses nothing: detections are kept per image and version, so images already taken are read again under the new version, and reviews are kept per image and model. Observation dates may be planned before any image exists. Treatments, units, protocol fields, and observation dates stay correctable so a miswritten label can be fixed. A unit with images or culture events cannot be deleted, because those records belong to the physical unit; a treatment is deleted with its units, so one whose units have records cannot be deleted either. The design never empties: an experiment keeps at least one treatment, and a treatment keeps at least one replicate, so the last of either can be neither deleted nor moved away. An inoculation date cannot move past an existing observation. An observation with an image or culture event cannot be deleted. An experiment with images or culture events cannot be hard-deleted.

A CultureEvent records contamination, nonviability, discard, harvest, or a missing unit against the observation where it was identified. Discarded, harvested, and missing are terminal events: the unit is absent from every later observation and analysis denominator, and a unit has at most one. Whether an event excludes the unit from analysis follows from its type: contaminated, discarded, and missing do, while a nonviable unit is a result rather than a loss and a harvested unit was measured. An event recorded by mistake is removed. Treatment rows show the per-unit mean, sample standard deviation, and `n` over eligible independent units.

An Observation is one occasion, dated by the day it happened and named by the days since inoculation. It cannot precede inoculation. An experiment is observed once a day at most, and observations are ordered by that day.

Observation images are assigned to the units they show, one per unit per observation. A source filename is retained for traceability but is not an identifier; it provides an initial code suggestion that the operator confirms. A cell that already has an image can be given a different one. An assignment can be removed without changing the canonical image, its inference outcome, or its annotation.

An uploaded JPEG, PNG, or TIFF is normalized to an oriented, opaque sRGB AVIF. Those bytes determine the image digest, dimensions, browser view, inference input, and training input.

`inference_outcomes` has one row per image and ModelVersion. A succeeded outcome contains classified boxes, including the valid zero-box case, and is immutable. A failed outcome contains the execution error and may be replaced through the explicit retry protocol; a conflicting successful result is rejected.

An annotation belongs to an image and Model, independent of the experiment or dataset from which it was opened and of any inference outcome. A review begins from what one ModelVersion found and is independent of that detection from then on: detections are recomputed by every version, while the annotation changes only when a person stores another review. The reviewer calibrates a local draft and submits it once. Submission freezes the draft; the save compares its original stored boxes with the current review in the same transaction. A conflict keeps the draft without overwriting another review. This calibration baseline belongs to the save request, not to the transferable annotation document; an image is reviewed once an annotation is stored for it, and only reviewed images enter dataset snapshots and YOLO exports. An image that should not train is removed from the dataset.

A Dataset travels as a manifest and the canonical images it names. The manifest carries the memberships and the annotations for the dataset's Model; another workbench imports it whole, provided it knows the Model with the same classes, holds every image, and has no dataset of that name and no annotation of those images for that Model. Detections in a manifest are informational and never imported.

## Scope

The current workbench covers one standardized image per unit and observation, read under one fixed detector version. A reading counts every instance found, whatever class it carries, so a rate separating a response from its population is read as two counts under two versions rather than from one image. Objects detected within a unit are subsamples, not independent biological replicates. A physical Petri-dish boundary remains an image-analysis diagnostic rather than the identity of the experimental unit.

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

Set `BETTER_AUTH_SECRET` in `web/.env` to a random value of at least 32 bytes (`openssl rand -base64 32`), then set the initial administrator email and password.

Start the workbench:

```bash
cd web
bun run dev
```

The workbench applies the SQL migrations in `web/drizzle/` when it starts. Its default source-development configuration connects to Postgres and RustFS on localhost and signs in with the administrator account from `web/.env`.

## Accounts

Everyone signs in with an email address and password; there is no self-service sign-up. Accounts hold one of two roles: administrators maintain the account directory under **Users**, and members use the workbench. Every user changes their own password under **Account**; administrators reset passwords for other accounts under **Users**. Suspending an account ends its sessions and refuses sign-in until it is reinstated; deleting one removes the account and its sessions and leaves experiment records untouched.

A deployment whose directory is empty creates its first administrator from `VITROFLOW_ADMIN_EMAIL` and `VITROFLOW_ADMIN_PASSWORD` when it starts. Once any account exists those variables are inert. `BETTER_AUTH_SECRET` signs session cookies, and `BETTER_AUTH_URL` is the public workbench origin that browser requests must match.

Authentication is [Better Auth](https://better-auth.com) over the application database, served at `/api/auth/*`. Programmatic access belongs to accounts too: under **Integrations** every account issues personal API keys for the agent and dataset transfer surfaces and reviews the MCP clients it has authorized. Worker credentials are separate bearer tokens configured on the deployment.

## Workers

Workers communicate only with the workbench HTTP API under one worker credential. Each native Worker profile has a stable worker ID, a fresh process-session ID, and a private work directory; every session heartbeats the runtimes it executes and the memory its accelerator offers, and what it is doing follows from the lease it holds. A Worker serves both queues: one that can train takes a queued training run before an inference pair, and one without the Ultralytics runtime only detects.

The Python package is published on PyPI as [`vitroflow`](https://pypi.org/project/vitroflow/); its own README is [docs/package.md](docs/package.md). On macOS, install it and configure `launchd` services:

```bash
uv tool install 'vitroflow[yolo]'

vitroflow worker setup mac-studio \
  --server http://localhost:3000 \
  --device mps
```

Setup validates authentication, runtime imports, and the selected device before saving the profile. The token is prompted without echo and is stored in `~/.vitroflow/profiles/<profile>/config.toml` with mode `0600`; LaunchAgent files contain no credentials.

Operational commands are:

```bash
vitroflow worker list
vitroflow worker status mac-studio
vitroflow worker doctor mac-studio
vitroflow worker logs mac-studio --follow
vitroflow worker restart mac-studio
vitroflow worker stop mac-studio
```

Workers advertise the traditional runtime and, when installed and importable, the pinned Ultralytics runtime. For inference they atomically claim one image/version pair, renew that lease while loading and predicting, download its canonical image and verified model artifact, and upload a succeeded or failed outcome. Completion consumes the current session's unexpired lease in the outcome transaction, so a reclaimed task fences the old process from writing.

For training they claim a queued run, download its immutable snapshot, materialize the canonical YOLO dataset, and advance through `preparing`, `training`, and `validating`. Every claim is fenced by worker ID, session ID, lease, and attempt. Completed epochs report losses, precision, recall, mAP50, mAP50-95, fitness, and learning rate. Publication registers verified `best.pt` bytes and their inference manifest as one candidate ModelVersion.

## Agent interface

AI agents maintain experiment records over the same domain layer the workbench uses, acting as the account that let them in. Every request is authorized afresh by its API key or MCP client; each command runs in one transaction that a failure rolls back whole. Every operation validates the request schema its workbench counterpart validates, so business invariants hold regardless of which face performed the write. The interface is documented in [docs/agent-api.md](docs/agent-api.md) and has two faces over one operation registry:

- `POST /api/agent/<operation>` calls one operation with its JSON input, authenticated by a personal API key with the agent scope as a bearer token. `GET /api/agent/operations` describes every operation with its JSON Schema, and `POST /api/agent/images` stores image bytes and returns the digest that observation assignment expects.
- `POST /api/mcp` serves the same operations as strict MCP 2026-07-28 tools. The workbench is the OAuth 2.1 authorization server for its own MCP endpoint: a client discovers it, sends the person to sign in and approve the connection, and loses access immediately when the person disconnects it.

```bash
claude mcp add --transport http vitroflow https://<workbench>/api/mcp
```

## Dataset transfer

A Dataset leaves a workbench as an archive: **Download** on the dataset page streams a ZIP holding the dataset's manifest and every image it names, stored uncompressed under the same layout as a local data root. **Import** on the Datasets page reads such an archive in the browser, stores each image under its digest, and then applies the manifest, so a dataset moves between workbenches with its annotations intact and nothing is re-encoded on the way.

Wire documents shared by the Web control plane and Python workers/CLI are defined by the Web Zod schemas. `bun run contracts:generate` emits their JSON Schemas into the Python package; `make check` refuses stale generated contracts. Python validates shared structure against those schemas before decoding domain objects and enforcing cross-field semantics.

The same transfer runs from the command line over `/api/transfer/`, opened by a personal API key that holds the transfer scope:

```bash
export VITROFLOW_SERVER_URL=http://localhost:3000
export VITROFLOW_API_KEY=<api-key>

uv run vitroflow dataset pull \
  --dataset fixtures \
  --data-root data

uv run vitroflow dataset push \
  --dataset fixtures \
  --data-root data
```

The local layout shares content-addressed blobs across datasets, and an unpacked archive is a data root for one dataset:

```text
data/
├── blobs/<xx>/<sha256>
└── datasets/<dataset>.json
```

Every command verifies blob digests before reading them. `push` sends a dataset to a workbench that does not have it yet and sends nothing otherwise.

A transferable manifest contains at most 10,000 images and 16 MiB of JSON; each canonical image is at most 64 MiB. These bounds keep validation and the final database transaction finite without constraining ordinary experimental datasets.

## Local dataset workflows

Run the bundled traditional detector over a pulled dataset:

```bash
uv run vitroflow recognize \
  --dataset fixtures \
  --data-root data \
  --output output/recognition
```

Evaluate or train its candidate scorer from reviewed annotations:

```bash
uv run vitroflow traditional evaluate \
  --dataset fixtures \
  --data-root data

uv run vitroflow traditional train \
  --dataset fixtures \
  --data-root data \
  --output output/models/traditional-candidate
```

Export the reviewed annotations as a deterministic YOLO dataset:

```bash
uv run vitroflow dataset export-yolo \
  --dataset fixtures \
  --data-root data \
  --output output/datasets/fixtures-yolo \
  --validation-fraction 0.2 \
  --seed 42
```

Fine-tune with the same pinned recipe and adapter a Worker uses:

```bash
uv run python scripts/train_yolo.py \
  --data output/datasets/fixtures-yolo/dataset.yaml \
  --output output/models/yolo-candidate \
  --device mps
```

`configs/yolo26/seed-small.recipe.json` fixes the base-weight digest, Ultralytics version, and training arguments. `--epochs`, `--imgsz`, and `--batch` provide explicit local overrides.

## Publishing the Python package

Set the new version in `pyproject.toml`, then build and upload from a clean `dist/`:

```bash
rm -rf dist
uv build
uv publish
```

`uv publish` reads the PyPI token from `UV_PUBLISH_TOKEN`. Tag the published commit with the same version.

## Deployment

Create the Compose environment and replace every credential before starting the deployment:

```bash
cp .env.example .env
docker compose up --build -d
```

Compose runs the workbench, maintenance process, Postgres 18.6, RustFS, and the one-shot bucket initializer. It exposes the workbench on port 3000 and RustFS on ports 9000 and 9001. Services restart unless stopped.

`HEROUI_KEY` is a build argument of the builder stage, which the published image does not carry. `VITROFLOW_WORKER_TOKEN` is the credential every Worker presents. `BETTER_AUTH_SECRET` is a random value of at least 32 bytes, such as `openssl rand -base64 32`. `BETTER_AUTH_URL` is the origin browsers and MCP clients reach the workbench at; it is the OAuth issuer and the MCP endpoint is bound to it, so it must be `https://` anywhere but localhost.

`zeabur-template.yaml` deploys the server side on Zeabur: the workbench built from `Dockerfile.web`, plus the marketplace PostgreSQL and MinIO services, which the dashboard maintains directly. Workers stay outside the platform. Zeabur has no one-shot service, so MinIO creates the bucket from its own start command.

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

`make check` is the local verification gate. The production image, real PostgreSQL invariants, and S3 contract are separate gates: run `make check-image`, `make check-postgres`, and `make check-s3` with their documented environment variables. The default suite uses PGlite and skips the external S3 contract when no endpoint is configured. The reference-image gate is reproducible from its digest manifest and runs wherever the private corpus is provisioned.

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

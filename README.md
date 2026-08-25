# VitroFlow

VitroFlow counts seeds in petri-dish photographs and produces reviewable detection overlays.

## Usage

```bash
uv sync
uv run vitroflow /path/to/images
```

Each image produces a JSON result, an annotated overlay, and a four-panel diagnostic image. A batch also produces `counts.csv`. The default output directory is `output/`; use `--output` to select another directory.

Results reference their source image by a path relative to `--data-root` (default: the current directory), so a run stays valid wherever the data directory is mounted. Images must live under the data root.

## Detection pipeline

```text
Dish geometry
→ Reference-region Lab normalization
→ Multi-scale center proposals
→ Candidate-local evidence
→ Review-calibrated seedness scoring
→ Scale-aware response deduplication
→ Counting and rendering
```

The reference region defines image statistics. The larger search region defines where candidates are generated.

Each candidate is described by local contrast, chroma, finite support, directional continuation, texture, surface compatibility, scale persistence, shape, and rim clearance. Seedness combines a global evidence model with a locally regularized calibration learned from reviews. Nearby responses are deduplicated before counting. Each JSON result records the model identity. Detected regions are generated after counting for visualization.

All geometric scales are fractions of the detected dish radius. Runtime parameters are grouped by responsibility in `PipelineConfig` and can be overridden with a nested JSON file:

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

Pass the file with `--config path/to/config.json`.

## Recognition and annotation

The Web app accepts image batches, queues recognition jobs, and turns Worker results into reviewed box annotations. Everything the service owns lives in one data directory:

```text
data/
├── images/<dataset>/<file>.jpg   source photographs
├── jobs/<job-id>.json            recognition job state
├── runs/<run-id>/                detection results and rendered views
├── labels/<dataset>/<stem>.json  reviewed box annotations
└── staging/<job-id>/             unpublished Worker results
```

An image is identified by its path under `images/`, so a photograph keeps one label across every run that processes it. Completed documents under `labels/` are the canonical reviewed instances used to build training datasets. Start the workbench and open the Jobs page to upload a batch:

```bash
cd web
bun install
bun run dev
```

Each annotation document holds the list of seed instances as axis-aligned boxes in source-image pixels. Detections seed the initial boxes; every box is reviewed by hand with the Select, Add box, and Pan tools, and box edits can be undone with `⌘Z` / `⇧⌘Z`. An image counts as training data only after the reviewer marks it `complete`; editing a completed image sends it back to `in_progress`. Images that should not be used can be marked `excluded`.

Edits are saved as they are made. A save that fails is retried before it is reported, and leaving an image waits for pending saves.

Run `bun test` in `web/` for the annotation, job lifecycle, and authentication tests.

### Web deployment

The workbench reads the data directory from `VITROFLOW_DATA_ROOT` (default: `../data` relative to `web/`). Build the image and mount the data directory:

```bash
docker compose up --build
```

`compose.yaml` mounts `./data` at `/data` and serves the workbench on port 3000. Set `VITROFLOW_PASSWORD` to require a password before any page, image, or save request is served; sessions last 30 days and end with the header's Sign out button. Leave it unset for a local workbench that needs no sign-in. Set `VITROFLOW_WORKER_TOKEN` to a separate random secret used only by the Worker. A job accepts up to 100 images, 64 MiB per image, and 512 MiB in total. Without Docker, `bun run build && bun run start` in `web/` serves the same production build.

### Local Worker

Run the Worker on a computer with the desired compute resources:

```bash
export VITROFLOW_SERVER_URL=https://vitroflow.example.com
export VITROFLOW_WORKER_TOKEN=<same-worker-secret-as-the-server>
uv run vitroflow-worker
```

Run one Worker instance for each workbench. It processes one job at a time, downloads each source image through the authenticated API, runs the recognition pipeline locally, and uploads the result JSON, overlay, and diagnostic image through the API. Interrupted work is resumed when the Worker starts again. Every result in a run must share one pipeline, model, and configuration identity. A run becomes visible to the annotation workbench only after every result has been validated and published. Use `--once` to process at most one job and exit.

## Project layout

```text
src/vitroflow/
├── geometry.py       Dish, reference, and search regions
├── normalization.py  Reference-based image normalization
├── proposals.py      Multi-scale candidate generation
├── candidates.py     Candidate-local evidence
├── scoring.py        Seedness model and review calibration
├── detection.py      Confidence selection and response deduplication
├── regions.py        Detection-region rendering
├── rendering.py      Overlay and diagnostic images
├── image_io.py       Image decoding and encoding
├── identity.py       Recognition pipeline identity
├── artifacts.py      Recognition result serialization
├── models.py         Result data structures
├── pipeline.py       Single-image orchestration
├── cli.py            Local batch command-line interface
└── worker.py         Remote job execution
```

## Development

```bash
uv run pytest
cd web && bun run build
```

Local image fixtures are described in [`tests/fixtures/README.md`](tests/fixtures/README.md).

## Quality warnings

- `dish_detection_failed`: the dish boundary could not be determined reliably.
- `exposure_clipping`: the reference region contains excessive clipped pixels.
- `low_focus`: the reference region may be out of focus.

## License

[MIT](LICENSE)

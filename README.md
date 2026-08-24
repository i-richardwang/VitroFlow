# VitroFlow

VitroFlow counts seeds in photographs of petri dishes. It detects seed centers from locally normalized color and brightness evidence.

## Usage

```bash
uv sync
uv run vitroflow /path/to/images
```

Results are written to `output/` by default. Each image produces:

- `<name>.json`: count, quality warnings, dish geometry, and detected centers;
- `<name>_overlay.jpg`: measurement boundary, detected regions, and labels;
- `<name>_debug.jpg`: measurement region, feature responses, and detection masks;
- `counts.csv`: count summary for the batch.

## Processing pipeline

```text
Dish detection
→ Measurement region
→ Local Lab background normalization
→ Polarity-invariant lightness contrast
→ Soft warm-color evidence
→ Seed-scale blob and edge analysis
→ Scale-aware center detection
→ Marker-based body partitioning
→ Counting, quality checks, and rendering
```

Measurements are limited to the central 60% of the detected dish radius by default, keeping labels, dish walls, reflections, and support edges outside the counting area. Keep all seeds inside the blue circle shown in the overlay.

The algorithm detects compact lightness extrema supported by local warm-color contrast. A seed-scale Hessian response and line-coherence analysis suppress seams, fibers, and support edges. Geometric and photometric scales are derived from the detected dish radius.

## Project layout

```text
.
├── src/vitroflow/
│   ├── cli.py            # Command-line interface and file output
│   ├── config.py         # Dimensionless pipeline parameters
│   ├── geometry.py       # Dish detection and measurement region
│   ├── features.py       # Local normalization and seed response
│   ├── detection.py      # Seed centers and body partitioning
│   ├── models.py         # Result data structures
│   ├── rendering.py      # Overlay and diagnostic images
│   └── pipeline.py       # Single-image pipeline orchestration
├── tests/
│   ├── fixtures/
│   │   ├── README.md     # Local fixture setup
│   │   └── images/       # Git-ignored images and manifest
│   ├── test_config.py
│   ├── test_pipeline.py
│   └── test_regression.py  # Runs against local image fixtures
├── web/                    # Local review workbench
├── pyproject.toml
├── uv.lock
└── README.md
```

## Review workbench

The `web/` directory contains a local web app for reviewing run results across iterations. Write each run into `data/runs/<run-name>`, then browse runs, per-image counts, and interactive detection overlays:

```bash
uv run vitroflow tests/fixtures/images -o data/runs/<run-name>
cd web && bun install && bun run dev
```

Clicking a detection drops it from the count; clicking anywhere else marks a seed the algorithm missed. Each calibrated image is written to `data/calibration/<run-name>/<image>.json` with the corrected count and the coordinates of every removed and added point.

## Development

```bash
uv run pytest
```

See [`tests/fixtures/README.md`](tests/fixtures/README.md) to configure local image fixtures. You can also process the fixture directory to inspect the complete output:

```bash
uv run vitroflow tests/fixtures/images
```

## Quality warnings

When `quality.status` is `review_required`, inspect the warnings attached to the result:

- `dish_detection_failed`: dish detection was inconclusive, so a centered circular measurement region was used;
- `exposure_clipping`: too many pixels are underexposed or overexposed;
- `low_focus`: the image may be out of focus.

## License

[MIT](LICENSE)

# VitroFlow

VitroFlow counts seeds in petri-dish photographs and produces reviewable detection overlays.

## Usage

```bash
uv sync
uv run vitroflow /path/to/images
```

Each image produces a JSON result, an annotated overlay, and a four-panel diagnostic image. A batch also produces `counts.csv`. The default output directory is `output/`; use `--output` to select another directory.

## Detection pipeline

```text
Dish geometry
→ Reference-region Lab normalization
→ Multi-scale center proposals
→ Candidate-local evidence
→ Calibrated confidence scoring
→ Scale-aware non-maximum suppression
→ Counting and rendering
```

The reference region defines image statistics. The larger search region defines where candidates are generated.

Each candidate is described by local contrast, chroma, finite support, directional continuation, texture, surface compatibility, scale persistence, shape, and rim clearance. A calibrated logistic model converts this evidence to confidence. Each JSON result records the model identity. Detected regions are generated after counting for visualization.

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

## Annotation workbench

The local web app turns run results into reviewed box annotations:

```bash
uv run vitroflow tests/fixtures/images -o data/runs/<run-name>
cd web
bun install
bun run dev
```

Each image gets one annotation document under `data/labels/<stem>.json` holding the list of seed instances as axis-aligned boxes in source-image pixels. Detections seed the initial boxes; every box is reviewed by hand with the Select, Add box, and Pan tools. An image counts as training data only after the reviewer marks it `complete`; editing a completed image sends it back to `in_progress`. Images that should not be used can be marked `excluded`.

Run `bun test` in `web/` for the geometry, pre-labeling, and review-status tests.

## Model fitting

Convert Web reviews into point annotations, then fit the candidate model while keeping each image intact across validation folds:

```bash
uv run python scripts/prepare_annotations.py \
  data/runs/<run-name> \
  data/calibration/<run-name> \
  data/annotations
uv run python scripts/train_candidate_model.py \
  data/annotations
```

The report includes proposal recall, the leave-one-image-out confidence threshold, and the fitted model parameters.

## Project layout

```text
src/vitroflow/
├── geometry.py       Dish, reference, and search regions
├── normalization.py  Reference-based image normalization
├── proposals.py      Multi-scale candidate generation
├── candidates.py     Candidate-local evidence
├── scoring.py        Candidate confidence scoring
├── detection.py      Confidence selection and scale-aware NMS
├── regions.py        Detection-region rendering
├── rendering.py      Overlay and diagnostic images
├── image_io.py       Image decoding and encoding
├── evaluation.py     Annotation labeling and model fitting
├── models.py         Result data structures
├── pipeline.py       Single-image orchestration
└── cli.py            Batch command-line interface
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

# Standalone visual annotation

**Source image + optional existing annotations → visual agent → complete annotations.**

Creating annotations and correcting existing ones use the same task. Each region requires one complete response; results can be exported once every region is complete. To request another round, supply the previous `result.json` as input, or omit existing annotations to start fresh.

The annotation package handles images, tiles, coordinates, validation, checkpoints, and export. A vision-capable agent inspects pixels, identifies objects, and supplies bounding boxes. Use the file commands with any external agent, or `annotate run` to supervise Pi automatically. Neither path requires a Worker connection or a segmentation model.

## Run with Pi

Install and authenticate Pi on the execution host, and configure a model that accepts images. The runner uses Pi's default model unless `--model provider/model` overrides it. A custom Pi model must declare `"input": ["text", "image"]`; Pi otherwise omits image content even if the underlying provider supports vision.

```bash
vitroflow annotate run --image photo.jpg --output output/ai-round-1

# An optional next round uses the same operation with candidate input.
vitroflow annotate run --image photo.jpg \
  --prelabels output/ai-round-1/result/result.json --output output/ai-round-2

# A bounded real-image trial before a full image run.
vitroflow annotate run --image photo.jpg --crop 512 1536 512 512 \
  --output output/ai-trial --timeout 600
```

`--pi` selects the executable; `--config` supplies tile settings, classes, and instructions. The runner resolves and freezes the selected Pi model at execution, checks its image capability without a model call, then launches one JSON-print session per image. Pi processes the tile tasks sequentially through three native tools: view, preview, and submit. The tool bridge invokes the same annotation CLI; it does not implement another agent loop or give the model a general-purpose Shell. An image task may use many view, preview, and submit tool calls; it does not create one session per tile.

The run directory contains:

```text
ai-round-1/
├── tasks/                 Portable package and validated checkpoints
├── tools/                 Pi tool extension, configuration, response previews
├── runtime/               Pi session.jsonl, events.jsonl, stderr.log
├── execution.json         Runtime version, selected model, reported usage
├── status.json            Supervisor completion or failure
└── result/
    ├── result.json        Source-coordinate annotations
    ├── responses.json     Original accepted responses
    ├── overlay.png        Visual inspection
    └── before-overlay.png
```

The supervisor collects results only after successful process completion and validation of every checkpoint. Exit code zero or a prose claim of completion is insufficient. Timeouts and cancellation terminate the process group. Missing provider usage remains unknown. Full local logs can contain image content and model output; execution directories are private to their owner.

A failed operation retains its task checkpoints and logs. The standalone task commands below can inspect or finish that package. The automatic runner never silently starts another paid attempt. To request another AI round, use a new directory with the previous result as optional input.

For the product and Worker integration, see [AI annotation](ai-annotation.md).

## First and subsequent rounds

```bash
# Estimate workload without creating files or calling a model.
vitroflow annotate plan --image photo.jpg

# Create annotations from the source image.
vitroflow annotate prepare --image photo.jpg --output output/round-1
# Give round-1/INSTRUCTIONS.md and the task package to a vision-capable agent.
vitroflow annotate status --run output/round-1
# Export after every region has an accepted response.
vitroflow annotate collect --run output/round-1 --output output/result-1

# Request another round using the previous result directly.
vitroflow annotate prepare --image photo.jpg \
  --prelabels output/result-1/result.json --output output/round-2
# Give the new package to the agent, then export its completed responses.
vitroflow annotate collect --run output/round-2 --output output/result-2
```

Each round uses new task and result directories; existing directories are never overwritten. The package freezes any supplied annotations as `input.json`, and the exported result preserves that input and its digest for traceability. The agent can keep, add, remove, split, or adjust any candidate and always returns a complete list. Repeating a task does not guarantee improvement. The tool does not automatically repeat tasks or select a preferred round.

`--prelabels` also accepts a compact format for manually authored or detector-generated candidates:

```json
{"image":{"sha256":"SHA-256 of the original image file","width":3072,"height":4096},
 "instances":[{"id":"p01","class":"seed",
   "bbox":{"x":100,"y":200,"width":20,"height":12}}]}
```

Input coordinates must use original image pixels after EXIF orientation is applied. The image digest and dimensions must match. Exported `result.json` files can be supplied directly; export metadata such as `taskId` and `producer` is not copied into local candidate boxes. Truncation flags are recomputed for the new geometry. A previous result may cover a different region, and areas without candidates still require inspection. `plan` also validates the input format and image identity.

## Image resolution and tiles

The tool preserves the decoded source resolution rather than resizing the image to a training size such as 1536. The frozen `source.png` and task images share the same decoded orientation. Final coordinates map back to that oriented source; coordinates must not be estimated from a chat thumbnail.

| Option | Default | Meaning |
| --- | ---: | --- |
| `--core-size` | 512 | Core region side length in source pixels |
| `--halo` | 32 | Context around each core region, in source pixels |
| `--display-scale` | 2 | Task image magnification, from 1 to 4 |

A 3072×4096 image produces a 6×8 grid of 48 regions with the default settings, requiring at least 48 accepted submissions. Tile count is not session count or API call count: an agent can handle multiple tiles, while previews and retries add operations. The default core size is configurable and has not been established as more accurate than other sizes.

```bash
vitroflow annotate prepare --image photo.jpg --crop 512 1536 512 512 \
  --core-size 512 --halo 32 --display-scale 2 --output output/local-round
```

`--config FILE` supports `coreSize`, `halo`, `displayScale`, `classes`, and `rules`; explicit CLI options take precedence. Custom classes require corresponding rules. The tool does not automatically skip blank regions, select a region of interest, or subdivide tiles recursively. Equal tile dimensions do not guarantee equal object sizes across photographs taken at different distances.

## Agent execution

The agent reads the package's `INSTRUCTIONS.md`, `manifest.json`, and each tile's `task.json`, then views `clean.png` and inspects the entire patch, including the halo and unboxed areas. Optional `prelabels.json` candidates are editable drafts, not constraints on object count or position.

The default seed rules require complete visible bodies, including pale coats and tips. Rectangles may overlap naturally when seeds touch. Agents should distinguish glare from seed bodies and avoid mechanically shrinking or expanding boxes. Ambiguous boundaries can be marked `uncertain`; areas where object presence cannot be determined belong in `issues`.

Save responses outside the checkpoint directory. Bounding boxes use display pixels of the task's `clean.png`:

```json
{
  "schemaVersion": "vitroflow.autoannotation/v5",
  "packageId": "packageId from manifest.json",
  "taskId": "tile-000-000",
  "producer": "actual agent/model/runtime",
  "instances": [
    {"id":"s01","class":"seed",
     "bbox":{"x":10,"y":20,"width":30,"height":12},
     "uncertain":false,"truncated":false}
  ],
  "issues": []
}
```

Empty regions still require `instances: []`. Local IDs must be unique within a response and need not reuse candidate IDs. The collector combines the task ID and local ID to identify each exported instance.

```bash
# Preview proposed coordinates without changing task state.
vitroflow annotate preview --run RUN --task tile-000-000 \
  --file response.json --output output/preview-1
# Inspect clean.png and proposed.png; before.png is included when candidates exist.
# Correct response.json as needed and use a new directory for another preview.
vitroflow annotate submit --run RUN --task tile-000-000 --file response.json
```

Previews preserve native task dimensions and show all neighboring candidates in separate images. Finding an object near a box does not establish that the box encloses it. The rendered preview provides coordinate feedback; the agent remains responsible for visual judgment.

## Checkpoints, recovery, and output

- `fail --run RUN --task TASK --message REASON` records an execution failure. Unaccepted responses can be retried directly.
- Identical resubmissions are idempotent. Accepted responses cannot be overwritten directly. `reset --run RUN --task TASK` archives the checkpoint before restarting the task. Use a new package when requesting another round on a completed result.
- Collection requires every region to be complete, including empty regions. The result directory must be outside the task package.
- Atomic writes, file digests, and short-lived process locks protect package integrity. Packages remain usable after being moved. The tool does not provide scheduling across hosts.

| Output | Purpose |
| --- | --- |
| `result.json` | Complete source-coordinate annotations, reusable as input to another round |
| `overlay.png` / `overlay-labels.json` | Final boxes and their number-to-ID mapping |
| `before-overlay.png` / `before-overlay-labels.json` | Input candidates; an unboxed image when no candidates were supplied |
| `responses.json` | Original agent responses for all tiles |
| `input.json`, when supplied | Frozen previous result or original candidate document |

Before and after overlays have independent number-to-ID mappings; equal numbers do not necessarily identify the same object. Results include unresolved issues, uncertainty, truncation flags, and possible duplicate warnings across tile boundaries. `inputDigest` identifies the frozen input document and is `null` when no input was supplied.

Each final box belongs to the core region containing its center. An owned box touching an internal patch boundary cannot be submitted; prepare a task with sufficient context. Source and coverage boundary truncation are recorded separately. Natural overlap is preserved, and possible duplicates across tile boundaries are reported. Geometry validation cannot detect every missed object or misplaced box.

Results have `reviewStatus=unreviewed`. Unresolved issues, uncertain instances, truncation, or seam warnings produce `qualityStatus=needs-review`; otherwise it remains `unverified`. Completion describes execution, not established accuracy or human approval.

## Module responsibilities

| File | Responsibility |
| --- | --- |
| `preparation.py` | Validate configuration, decode images, plan tiles, and freeze inputs |
| `protocol.py` | Define the data contract, validate inputs and responses, and provide annotation rules |
| `instructions.py` | Supply execution instructions for visual agents |
| `tasks.py` | Validate package integrity, report status, preview, submit, and recover tasks |
| `results.py` | Assign core ownership, restore source coordinates, and export results |
| `geometry.py` / `rendering.py` | Compute coordinates and render boxes |
| `storage.py` / `command.py` | Handle file I/O and CLI arguments |

The protocol accepts one current schema and validates it when reading files. Task states are `pending`, `failed`, and `complete`; `status` reports `invalid` for damaged checkpoints. The schema identifier detects mismatched files rather than selecting different execution flows.

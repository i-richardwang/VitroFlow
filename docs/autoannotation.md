# Standalone visual annotation

**Source image + optional existing annotations → visual agent → complete annotations.**

Creating annotations and refitting existing ones use one annotation operation with distinct visual task instructions. Each region requires one complete response; results can be exported once every region is complete. To request another round, supply the previous `result.json` as input, or omit existing annotations to start fresh.

The annotation package handles images, tiles, coordinates, validation, checkpoints, and export. A vision-capable agent inspects pixels, identifies objects, and supplies bounding boxes. Use the file commands with any external agent, or `annotate run` to supervise Pi or Antigravity automatically. Neither path requires a Worker connection or a segmentation model.

## Run with an external agent

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

Select a runtime explicitly when needed:

```bash
# One-time Antigravity tool registration after installing VitroFlow.
vitroflow annotate setup --runtime antigravity
vitroflow annotate run --runtime antigravity --image photo.jpg --output output/agy-round
vitroflow annotate run --runtime pi --image photo.jpg --output output/pi-round

# Region size and magnification are independent, for either runtime.
vitroflow annotate run --runtime antigravity --image photo.jpg \
  --core-size 256 --halo 32 --display-scale 4 --output output/agy-small-regions
```

`--runtime` defaults to `pi`; `--executable` selects its executable and `--model` optionally overrides its default. `--config` supplies tile settings, classes, and instructions. The runner resolves and freezes the runtime descriptor, then launches one independent session per region. `--parallel` bounds concurrent sessions (default 2, range 1–16); `--timeout` applies to each session. Both runtimes use the same normalized view, preview, and submit operations. Each tool is bound to that session's task and attempt; it cannot operate on another region. The first view supplies a full-image overview (longest side at most 1024 pixels) with the current patch outlined, the native-scale CLEAN patch, and optional INITIAL references. Subsequent previews pair CLEAN and PROPOSED.

Antigravity setup registers a local stdio MCP bridge and three scoped tool permissions. It is a one-time host configuration, not a per-run global edit. The executing process binds that bridge to its own task; a standalone Antigravity session has no such binding. See [AI annotation](ai-annotation.md) for configuration, permissions, and runtime differences.

The run directory contains:

```text
ai-round-1/
├── tasks/                 Frozen shared input, including per-patch overview.png
├── request.json           Original image/input/settings identity for explicit resume
├── descriptor.json        Frozen runtime identity
├── state.json             Coordinator-owned attempts and accepted responses
├── attempts/<task>/<attempt>/
│   ├── tools/             Bound configuration and immutable proposal versions
│   ├── runtime/           Runtime bridge assets, events.jsonl, stderr.log
│   ├── prompt.txt         Instructions for exactly this region
│   └── execution.json     This attempt's process outcome
├── execution.json         Runtime identity and accepted attempt outcomes
├── status.json            Supervisor completion or failure
└── result/
    ├── result.json        Source-coordinate annotations
    ├── responses.json     Original accepted responses
    ├── overlay.png        Visual inspection
    └── before-overlay.png
```

The supervisor collects results only after the coordinator has durably accepted every task. Each runtime can stop as soon as its own submission is accepted. Completion callbacks read in-memory events, not package files or image checksums; events are reconstructed from state.json on recovery. Exit code zero or a prose claim of completion is insufficient. Timeouts and cancellation terminate the process group. Missing provider usage remains unknown. Full local logs can contain image content and model output; execution directories are private to their owner.

A failed session stops further dispatch; the sessions already running finish, and their acceptances are kept with the private attempts and logs. To retry only the unfinished regions, repeat the original command and settings with `--resume`: accepted regions are reused without model calls, retried regions get new attempt IDs, and submissions from superseded attempts are fenced by attempt identity. Resuming a completed run recovers export and delivery. A run with a live supervisor refuses a second one. Retrying a failed session is always this explicit request.

```bash
vitroflow annotate run --image photo.jpg --output output/ai-round-1 --parallel 2 --resume
```

The manual file commands below operate on portable checkpoints. They do not modify the coordinator's accepted responses in a supervised run. To request another annotation round or an independent seam review, use a new directory with the previous result as optional input and, if appropriate, a seam-spanning `--crop`.

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

Omit `--prelabels` to request an independent annotation. Supply it when the agent should consider an existing proposal. Regions with references receive a visual refit task and paired clean/reference images; regions without references receive a fresh annotation task. Both return a complete list. This does not add a separate reviewer or guarantee that existing errors will be corrected.

Input coordinates must use original image pixels after EXIF orientation is applied. The image digest and dimensions must match. Exported `result.json` files can be supplied directly; export metadata such as `taskId` and `producer` is not copied into local candidate boxes. Truncation flags are recomputed for the new geometry. A previous result may cover a different region, and areas without candidates still require inspection. `plan` also validates the input format and image identity.

## Image resolution and tiles

The tool preserves the decoded source resolution rather than resizing the image to a training size such as 1536. The frozen `source.png` and task images share the same decoded orientation. Final coordinates map back to that oriented source; coordinates must not be estimated from a chat thumbnail.

| Option | Default | Meaning |
| --- | ---: | --- |
| `--core-size` | 512 | Core region side length in source pixels |
| `--halo` | 32 | Context around each core region, in source pixels |
| `--display-scale` | 1 | Task image magnification, from 1 to 4 |

By default, task images retain the source patch pixels without interpolation. Explicit magnification remains available for controlled experiments. Context adds source pixels around the core before display magnification. For example, an interior 256-pixel core with 32-pixel context is a 320×320 patch, displayed as 1280×1280 at 4×. Source/crop boundaries clip that context. Magnification changes presentation, not coverage or final source coordinates.

A 3072×4096 image produces a 6×8 grid of 48 regions with the default settings, requiring 48 accepted submissions and 48 independent sessions on the initial supervised run. Each session can make several tool or model calls; explicit retries add sessions for unfinished regions. The default core size is configurable and has not been established as more accurate than other sizes.

```bash
vitroflow annotate prepare --image photo.jpg --crop 512 1536 512 512 \
  --core-size 512 --halo 32 --display-scale 1 --output output/local-round
```

`plan`, `prepare`, and `run` accept these same region flags. `--config FILE` supports `coreSize`, `halo`, `displayScale`, `classes`, and `rules`; explicit CLI options take precedence. Custom classes require corresponding rules. The tool does not automatically skip blank regions, select a region of interest, or subdivide tiles recursively. Equal tile dimensions do not guarantee equal object sizes across photographs taken at different distances.

## Agent execution

The agent reads the package's `INSTRUCTIONS.md`, `manifest.json`, and each tile's `task.json`, then views `clean.png` and inspects the entire patch, including the halo and unboxed areas. When `before.png` is present, view it as INITIAL alongside CLEAN and follow the refit task: locate visible bodies and re-estimate all four edges rather than copying old coordinates. Short reference IDs are local to the task. The original `prelabels.json` coordinates remain available for machine audit; supervised tools supply only reference IDs/classes and the image overlay. Regions without references use the fresh task, locating bodies across the whole clean patch.

The default seed rules require complete visible bodies, including pale coats and tips. Rectangles may overlap naturally when seeds touch. Agents should distinguish glare from seed bodies and avoid mechanically shrinking or expanding boxes. Ambiguous boundaries can be marked `uncertain`; areas where object presence cannot be determined belong in `issues`.

`annotation_preview` returns CLEAN and PROPOSED together so geometry is checked against the unmarked pixels. A second preview is useful for a changed proposal; repeating an unchanged overlay adds no new coordinate feedback.

The file commands below accept display-pixel boxes. The supervised agent preview used by `annotate run` instead accepts normalized `box_2d` edges and optional issues. It returns a `proposalId`; the agent submits that ID after viewing the preview, without repeating coordinates. The file-based commands below retain their complete response format; see [AI annotation](ai-annotation.md).

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

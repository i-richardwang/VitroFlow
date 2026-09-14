# AI annotation

VitroFlow supports detector results, AI proposals, and accepted human reviews as separate records. AI annotation runs an existing agent runtime; VitroFlow does not implement an agent reasoning loop. Pi is the supported runtime adapter.

## Product workflow

1. Open an image and enter calibration.
2. In **AI annotation**, choose an online annotation Worker and the starting point: **Image only** or **Current draft**. Instructions describe the labeling task; seed instructions are supplied by default, while other classes require explicit instructions.
3. Start a run. The server freezes the exact canonical image identity, labeling model/classes, candidate input, saved-review baseline, instructions, and Worker runtime descriptor. Progress counts accepted regions.
4. A Worker claims the run and downloads the canonical product image. Pi reads the portable task package, inspects the images, and submits complete annotations. It can remove, add, split, or refit candidates.
5. The supervisor validates all checkpoints and exports source-coordinate annotations. The server validates identity, geometry, classes, runtime, and completion evidence before marking the run successful.
6. Choose **Load into draft** to replace the current draft. This action is undoable. Polling never modifies the canvas. Inspect and save through the existing review flow; AI completion alone never marks an image reviewed or makes it eligible for training.
7. For another round, load a result, choose **Current draft**, and start a new run. There is no mandatory second reviewer or automatic repeat loop.

The panel polls runs while work is active. Worker availability is checked by the server when a run is created; starting a run does not perform a separate client preflight. **Refresh workers and runs** discovers Workers or operations started elsewhere while the panel is idle. Reading runs derives expired lease status without mutating records; lifecycle mutations retire expired work.

Saving compares the persisted annotation against the draft's original baseline and refuses concurrent replacement.

## Worker setup

Install Pi separately and configure its default vision model and authentication on the Worker host. VitroFlow does not store provider credentials in the product or construct its own provider client.

```bash
vitroflow worker setup annotator \
  --server https://your-workbench.example \
  --ai-annotation
```

An existing profile can enable the capability in its private `config.toml`:

```toml
ai_annotation = true
pi_executable = "/absolute/path/to/pi"
# Optional; omit to use Pi's default model.
# pi_model = "provider/model"
```

Run `vitroflow worker doctor annotator` and restart the profile. A configured runtime must be executable and resolve to a model declaring image input. This configuration check does not spend model tokens or guarantee provider availability; authentication and network failures are surfaced as failed runs. An API-backed annotation runtime does not need a GPU or the Ultralytics extra.

The macOS service captures the command search path when installed so Pi and its Node interpreter remain discoverable outside an interactive shell. After changing that path, run `vitroflow worker stop annotator` followed by `vitroflow worker start annotator` from the correctly configured terminal to reload the service environment.

A Worker probes Pi at startup to advertise its capabilities. Each new annotation operation probes once to check the frozen assignment and passes that descriptor into execution.

A Worker advertises the selected runtime/version/model separately from detector adapters. The product selects a Worker, not a detector model version. Requests are pinned to that Worker's advertised configuration. If it goes offline, queued requests remain visible and cancellable; if its configuration changes, cancel the queued run and start again with the current Worker. A running process handles one assignment at a time, prioritizing interactive annotation, then training, then inference.

Pi runs with automatic extension discovery, skills, and ambient context files disabled. VitroFlow explicitly loads a small Pi extension exposing only `annotation_view`, `annotation_preview`, and `annotation_submit`. These tools serve the frozen image and invoke the existing annotation CLI; the model has no general-purpose Shell or file-editing tool during this operation. The subprocess receives a limited environment that excludes VitroFlow/DB credentials. Pi retains its own provider authentication. This is a trusted-host integration, **not an operating-system sandbox**: the installed runtime and trusted tool extension execute with the host user's filesystem privileges.

## Records and files

`annotation_runs` stores immutable requests, labeling scope, input/baseline snapshots, runtime provenance, Worker ownership, lease, progress, and the compact validated result in Postgres. Image bytes remain in the existing content-addressed blob store. The run's image reference participates in image retention. The proposal is independent of `annotations`, which continues to hold the accepted review used by training snapshots.

Product execution metadata contains only runtime, version, model, and elapsed seconds. Per-message usage and costs remain in the Worker’s `execution.json`. Progress reporting is best effort; a transient reporting failure does not interrupt model execution. Lease loss and cancellation still stop the operation.

The Worker retains full artifacts under:

```text
<worker-work-directory>/annotations/<run-id>/
├── image.avif
├── input.json              Present when candidate input was supplied
├── product-result.json     Validated upload payload, reusable after a lost reply
└── execution/              Standalone run directory and local Pi logs
```

Product result coordinates describe the exact canonical oriented AVIF pixels, identified by their SHA-256. They are never substituted for the digest of an original camera JPG. Standalone runs preserve the identity of their own input file. Training resizing is independent of annotation coordinates.

The product uses 512-pixel cores, 32-pixel context, and 2× display magnification. A 3072×4096 image has 48 regions at these settings. This is a workload choice, not a measured accuracy guarantee. Original dimensions and scaling remain explicit in every task. Glare, touching bodies, and uncertain extents must be evaluated visually; protocol validation cannot establish precision or recall.

## Ownership and failure semantics

The existing Worker bearer realm protects annotation claim/image/progress/lease/completion endpoints. Browser actions require the normal authenticated session. A request ID is idempotent only for the same creator and frozen input; one image/model can have at most one active run. A replayed claim returns the same assignment.

A live lease belongs to one Worker session. Cancellation, expiration, and session replacement prevent late progress or completion from becoming accepted results. Completion retries with the same payload and original owner are idempotent. Lease expiration fails explicitly; there is no automatic cross-host restart, shared checkpoint service, or hidden paid retry. A completed local payload can be uploaded again after an uncertain transport response. Incomplete local work is retained for inspection, and a new paid operation requires a new request.

## Source ownership

- `autoannotation/`: portable task geometry, validation, checkpoints, and rendering.
- `agent_runtimes/pi.py`: model discovery, Pi subprocess protocol, lifetime, and execution provenance.
- `agent_annotation/command.py`: command-line arguments and presentation.
- `agent_annotation/runner.py`: annotation instructions, package preparation, progress, and deterministic collection.
- `agent_annotation/pi_tools.ts`: a Pi-native tool bridge for region images, previews, and submissions; all geometry validation remains in the annotation CLI.
- `worker/annotation.py`: authenticated assignment, image download, leases, and result upload.
- `web/src/domain/annotation-runs/`: product and transport contracts.
- `web/src/server/annotation-runs/`: durable run lifecycle and proposal validation.
- `web/src/features/calibration/AiAnnotation.tsx`: starting, monitoring, and loading a proposal into the existing draft.

A future Codex or Claude Code adapter implements process execution against the same portable annotation package and completion rules. Runtime-specific CLI events stay out of annotation geometry, product persistence, and calibration state. No runtime plugin framework is required before a second adapter exists.

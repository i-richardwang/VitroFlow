# AI annotation

VitroFlow supports detector results, AI proposals, and accepted human reviews as separate records. AI annotation runs an existing agent runtime; VitroFlow does not implement an agent reasoning loop. Pi and Antigravity are supported runtime adapters.

## Product workflow

1. Open an image and enter calibration.
2. In **AI annotation**, choose an online annotation Worker, an available Agent (Pi or Antigravity), the starting point (**Image only** or **Current draft**), region size in original-image pixels, and display magnification. Instructions describe the labeling task; seed instructions are supplied by default, while other classes require explicit instructions.
3. Start a run. The server freezes the exact canonical image identity, labeling model/classes, candidate input, saved-review baseline, region settings, instructions, and Worker runtime descriptor. Progress counts accepted regions.
4. A Worker claims the run and downloads the canonical product image. The selected agent reads the portable task package, inspects the images, and submits complete annotations. It can remove, add, split, or refit candidates.
5. The supervisor validates all checkpoints and exports source-coordinate annotations. The server validates identity, geometry, classes, runtime, and completion evidence before marking the run successful.
6. Choose **Load into draft** to replace the current draft. This action is undoable. Polling never modifies the canvas. Inspect and save through the existing review flow; AI completion alone never marks an image reviewed or makes it eligible for training.
7. For another round, load a result, choose **Current draft**, and start a new run. There is no mandatory second reviewer or automatic repeat loop.

Use **Image only** for an independent proposal, including a fresh attempt after an unsatisfactory result. **Current draft** supplies reference images for visual refitting: the agent compares the clean pixels with numbered previous boxes and re-estimates visible edges. These inputs have distinct task instructions, while both produce complete proposals and permit changes to instance count and geometry. Regions without references use the fresh task. Neither instruction set guarantees visual correctness; inspect results before saving.

The panel polls runs while work is active. Worker availability is checked by the server when a run is created; starting a run does not perform a separate client preflight. **Refresh workers and runs** discovers Workers or operations started elsewhere while the panel is idle. Reading runs derives expired lease status without mutating records; lifecycle mutations retire expired work.

Saving compares the persisted annotation against the draft's original baseline and refuses concurrent replacement.

## Worker setup

Install and authenticate the desired runtimes on the Worker host: `pi` for Pi and `agy` for Antigravity. Configure each runtime's default vision model there. VitroFlow uses their existing authentication and does not construct a provider client.

Register the Antigravity tools once after installing VitroFlow:

```bash
vitroflow annotate setup --runtime antigravity
```

This explicit setup registers `vitroflow-annotation` in `~/.gemini/config/mcp_config.json` and grants its three tool operations in `~/.gemini/antigravity-cli/settings.json`. Other settings, MCP servers, and restrictive ask/deny rules are preserved. A conflicting server name is rejected. Repeat setup after moving or reinstalling the Python environment. Normal annotation runs never edit these global files.

The MCP entry launches a local stdio process bound to the current task through its subprocess environment. It does not listen on a network port or run as a persistent service. An unrelated Antigravity session without a task binding cannot access annotation tasks through this entry. This registration uses the global MCP configuration supported by the tested Antigravity CLI 1.2.3; task-directory MCP discovery is not assumed.

Enable either or both runtimes on a Worker:

```bash
vitroflow worker setup annotator \
  --server https://your-workbench.example \
  --annotation-runtime pi \
  --annotation-runtime antigravity
```

The private Worker `config.toml` represents each enabled runtime once:

```toml
[[annotation]]
runtime = "pi"
# Optional; omit to use the runtime's current default.
# model = "provider/model"
# executable = "/absolute/path/to/pi"

[[annotation]]
runtime = "antigravity"
# model = "model-slug"
# executable = "/absolute/path/to/agy"
# timeout_seconds = 1800
```

An empty annotation list disables AI annotation. Run `vitroflow worker doctor annotator` and restart the profile after changing configuration. Doctor checks every configured runtime. A Worker advertises successfully probed runtimes; an unavailable annotation runtime is logged without disabling detection or another usable runtime. Restart the Worker after repairing its runtime configuration.

Pi's probe verifies that the selected model declares image input. Antigravity's probe verifies tool registration and resolves the current model through its CLI; it does not independently certify model vision quality. Probes do not send annotation requests. Authentication, provider access, tool permissions, and image support still require a real smoke test. Runtime defaults such as an `auto` route do not reveal the identity of a model hidden behind that route.

A Worker advertises its runtime/version/model descriptors separately from detector adapters. The product freezes the selected descriptor with the request. Each new annotation operation probes once and rejects a changed descriptor before execution. Queued tasks cannot silently switch runtimes or models. A Worker still handles one assignment at a time, prioritizing annotation, then training, then inference. No cross-runtime fallback or automatic paid retry is added.

The macOS service captures the command search path when installed. After changing that path, stop and start the profile from the correctly configured terminal to reload its environment. API-backed annotation does not need a GPU or the Ultralytics extra.

## Tools and runtime boundaries

Both runtimes use the same three operations: `annotation_view`, `annotation_preview`, and `annotation_submit`. One Python implementation owns model-facing metadata, normalized coordinate conversion, and calls into the portable annotation package. The Pi extension only binds these tools to Pi; Antigravity accesses them through MCP. There is no second implementation of annotation geometry.

All model-facing boxes use `box_2d: [ymin, xmin, ymax, xmax]`, normalized to 0–1000 relative to the displayed region; fractional values are allowed. Previous coordinates are retained in the frozen package for audit, but are not returned to the model. The tools convert edges with the actual display width and height; the portable package validates and maps boxes to the original image. Agents do not calculate display scaling or crop offsets. The same contract applies to standalone and Worker execution.

`annotation_view` returns the clean image and, when references exist, a separate numbered INITIAL image at identical dimensions. Short task-local IDs avoid labels growing across rounds; only reference IDs and classes accompany the images. A prior box may contain zero, one or multiple bodies. The refit task asks the agent to locate complete outlines in CLEAN, estimate all four edges, and then scan unboxed areas. The fresh task starts by locating bodies across the entire patch.

`annotation_preview` returns both CLEAN and PROPOSED, preserving the image evidence during geometry correction. Agents compare visible extremities with all four drawn edges and may use a second preview for a changed proposal. The supervisor stores the exact shared prompt as `prompt.txt`; both runtime adapters use the same task semantics and image pairs. This is visual feedback, not a geometry optimizer or an automatic repeated-review loop.

Pi disables automatic extension discovery, skills, and ambient context files, and exposes only the three annotation tools. Antigravity retains its native tool surface and existing permission policy; VitroFlow does not pass `--dangerously-skip-permissions`. Shared instructions restrict annotation work to the supplied tools and native image viewing. MCP image content may be materialized by Antigravity as an image file opened by its native viewer. Do not mistake a prompt restriction for a runtime tool allowlist or an OS sandbox.

Both subprocesses receive a limited environment excluding Worker and database credentials, while retaining their own provider authentication. Runtime executables and tools run with the host user's filesystem privileges. Full validated checkpoints determine completion; an exit code of zero or a final assistant message alone cannot produce a successful annotation. Both runtimes are stopped once all submitted checkpoints validate, even if they would continue talking. Cancellation and lease loss take precedence over collection.

## Records and files

`annotation_runs` stores immutable requests, labeling scope, input/baseline snapshots, runtime provenance, Worker ownership, lease, progress, and the compact validated result in Postgres. Image bytes remain in the existing content-addressed blob store. The run's image reference participates in image retention. The proposal is independent of `annotations`, which continues to hold the accepted review used by training snapshots.

Product execution metadata contains only runtime, version, model, and elapsed seconds. Runtime-specific usage, terminal events, and transcripts remain in the local execution artifacts. Progress reporting is best effort; a transient reporting failure does not interrupt model execution. Lease loss and cancellation still stop the operation.

The Worker retains full artifacts under:

```text
<worker-work-directory>/annotations/<run-id>/
├── image.avif
├── input.json              Present when candidate input was supplied
├── product-result.json     Validated upload payload, reusable after a lost reply
└── execution/              Standalone run directory and local runtime logs
```

Product result coordinates describe the exact canonical oriented AVIF pixels, identified by their SHA-256. They are never substituted for the digest of an original camera JPG. Standalone runs preserve the identity of their own input file. Training resizing is independent of annotation coordinates.

The product defaults to 512-pixel cores, 32-pixel context, and 2× display magnification. The panel offers 128, 256, 512 and 1024-pixel cores, independently of 1–4× magnification. The API freezes the full region configuration with each request; changing it requires a new request identity. Result history shows the actual core size and magnification used. A 3072×4096 image has 48 regions at 512 or 192 at 256. Region count is not session count. These are workload choices, not measured accuracy guarantees.

Context is additional source-image area, clipped at image boundaries. A full interior 256-pixel core with 32-pixel context and 4× magnification is displayed as 1280×1280; a standalone crop restricted to 256×256 cannot include outside context and displays as 1024×1024. Magnification does not add source pixels or change the covered area. Original dimensions and scaling remain explicit in every task. Glare, touching bodies, and uncertain extents must be evaluated visually; protocol validation cannot establish precision or recall.

## Ownership and failure semantics

The existing Worker bearer realm protects annotation claim/image/progress/lease/completion endpoints. Browser actions require the normal authenticated session. A request ID is idempotent only for the same creator and frozen input; one image/model can have at most one active run. A replayed claim returns the same assignment.

A live lease belongs to one Worker session. Cancellation, expiration, and session replacement prevent late progress or completion from becoming accepted results. Completion retries with the same payload and original owner are idempotent. Lease expiration fails explicitly; there is no automatic cross-host restart, shared checkpoint service, or hidden paid retry. A completed local payload can be uploaded again after an uncertain transport response. Incomplete local work is retained for inspection, and a new paid operation requires a new request.

## Source ownership

- `autoannotation/`: portable task geometry, validation, checkpoints, and rendering.
- `agent_runtimes/contract.py`: execution interface and tool binding contract.
- `agent_runtimes/config.py`: explicit runtime configuration and construction.
- `agent_runtimes/pi.py`, `antigravity.py`: runtime discovery, protocol events, completion semantics, and local execution provenance.
- `agent_runtimes/process.py`: shared JSON event capture, environment boundary, and process cleanup.
- `agent_runtimes/pi_tools.ts`, `mcp.py`, `setup.py`: native transport bridges and explicit Antigravity registration.
- `agent_annotation/command.py`: command-line entry points and presentation.
- `agent_annotation/instructions.py`: shared runtime prompt and visual execution flow.
- `autoannotation/instructions.py`: fresh/refit task briefs and visual fitting rules.
- `agent_annotation/runner.py`: package preparation, prompt persistence, progress, and deterministic collection.
- `agent_annotation/tools.py`: common model-facing tool operations and their invoke/MCP transports.
- `worker/annotation.py`: authenticated assignment, image download, leases, and result upload.
- `web/src/domain/annotation-runs/`: product and transport contracts.
- `web/src/server/annotation-runs/`: durable run lifecycle and proposal validation.
- `web/src/features/calibration/AiAnnotation.tsx`: starting, monitoring, and loading a proposal into the existing draft.

A future Codex or Claude Code adapter implements process execution against the same portable annotation package and completion rules. Runtime-specific CLI events stay out of annotation geometry, product persistence, and calibration state. Runtime construction is explicit; no dynamic plugin registry is required.

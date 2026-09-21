# AI annotation

VitroFlow supports detector results, AI proposals, and accepted human reviews as separate records. AI annotation runs an existing agent runtime; VitroFlow does not implement an agent reasoning loop. Pi and Antigravity are supported runtime adapters.

## Product workflow

An image read for a model can hold three readings, and they rank: a reviewer's calibration outranks an agent's proposal, which outranks the detector's result. Every page reads an image by the best reading it has: the image page shows it, the dataset list counts it, and an experiment's grid and workbook read by it. Only a calibration marks an image reviewed or lets it train.

1. Open an image. The page shows its best reading; the switch in the toolbar shows any other it has: **Detected**, **AI proposal**, **Review**.
2. Choose **AI annotation** and one of two starts: **From the image** for an independent proposal, or **Refit the boxes shown** to improve whatever the page shows, the draft while calibrating. With several agents online the menu names each. What to draw and how to look at the image belong to the model: its classes, annotation instructions and region settings are edited on the **Models** page, not per run. A model without instructions cannot start AI annotation until they are added.
3. The server freezes the exact canonical image identity, the model's classes, instructions and region settings, the starting boxes, and the agent name. Progress counts accepted regions, and the page keeps refreshing while an agent is at work. The inspector's **AI proposal** section shows the progress and a cancel action, then the newest proposal's agent, time, box count and areas needing attention.
4. Any online Worker that runs the requested agent claims the run and downloads the canonical product image. A local coordinator launches an independent agent session per region, with up to two running concurrently. Each sees its own clean patch and a full-image location overview, and submits only that region. It can remove, add, split, or refit candidates.
5. The coordinator durably accepts each region, and the supervisor exports those accepted responses into source coordinates. The server validates identity, geometry, classes, runtime, and completion evidence before marking the run successful. The newest successful run is the image's proposal; older runs stay as records.
6. Calibrate. The draft begins from the reading shown, and the toolbar's reset menu replaces it with any other reading: the proposal, the detection, or the stored review. Resetting is undoable. Save through the existing review flow.
7. To annotate many images at once, choose **AI annotation** on a dataset page or **AI-annotate uncalibrated images** in an observation's menu. The dialog states how many images an agent will draw; calibrated images and images an agent is already reading are left alone.

**From the image** starts the fresh task. **Refit the boxes shown** supplies reference images for visual refitting: the agent compares the clean pixels with numbered previous boxes and re-estimates visible edges. These inputs have distinct task instructions, while both produce complete proposals and permit changes to instance count and geometry. Regions without references use the fresh task. Neither instruction set guarantees visual correctness; inspect results before saving.

Worker availability is checked by the server when a run is created; the pages list the agents online Workers advertise. Reading a run derives expired lease status without mutating records; lifecycle mutations retire expired work. Saving compares the persisted annotation against the stored review the draft was opened on and refuses concurrent replacement.

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

A Worker advertises its runtime/version/model descriptors separately from detector adapters; the workbench uses them to list the agents currently available. A run names an agent, not a Worker: it is claimed by capability, like training, so a queued run waits for any Worker that runs that agent and never for one particular process. The Worker probes the runtime once per operation and records the version and model it actually ran in the result, which is the run's provenance. A Worker still handles one assignment at a time, prioritizing annotation, then training, then inference. No cross-runtime fallback or automatic paid retry is added.

The macOS service captures the command search path when installed. After changing that path, stop and start the profile from the correctly configured terminal to reload its environment. API-backed annotation does not need a GPU or the Ultralytics extra.

## Tools and runtime boundaries

Both runtimes use the same three operations: `annotation_view`, `annotation_preview`, and `annotation_submit`. One Python implementation owns model-facing metadata, normalized coordinate conversion, and calls into the portable annotation package. The Pi extension only binds these tools to Pi; Antigravity accesses them through MCP. There is no second implementation of annotation geometry.

All model-facing boxes use `box_2d: [ymin, xmin, ymax, xmax]`, normalized to 0–1000 relative to the displayed region; fractional values are allowed. Previous coordinates are retained in the frozen package for audit, but are not returned to the model. The tools convert edges with the actual display width and height; the portable package validates and maps boxes to the original image. Agents do not calculate display scaling or crop offsets. The same contract applies to standalone and Worker execution.

`annotation_view` returns a full-image OVERVIEW with a location rectangle, CLEAN, and, when references exist, a separate numbered INITIAL image matching CLEAN dimensions. Short task-local IDs avoid labels growing across rounds; only reference IDs and classes accompany the images. A prior box may contain zero, one or multiple bodies. The refit task asks the agent to locate complete outlines in CLEAN, estimate all four edges, and then scan unboxed areas. The fresh task starts by locating bodies across the entire patch.

`annotation_preview` accepts the complete instance list and optional issues (omission means an empty list). It freezes the validated proposal and returns its `proposalId` with both CLEAN and PROPOSED, preserving image evidence during geometry correction. `annotation_submit` accepts only `taskId` and `proposalId`, verifies their binding and content digest, and accepts exactly that previewed proposal. Changed geometry requires another preview. The receipt describes the submitted task instead of repeating the package task list. Agents compare visible extremities with all four drawn edges and may use a second preview for a changed proposal. Each attempt stores its exact single-task prompt as `prompt.txt`; both runtime adapters use the same task semantics and image pairs. This is visual feedback, not a geometry optimizer or an automatic repeated-review loop.

Pi disables automatic extension discovery, skills, and ambient context files, and exposes only the three annotation tools. Antigravity retains its native tool surface and existing permission policy; VitroFlow does not pass `--dangerously-skip-permissions`. Shared instructions restrict annotation work to the supplied tools and native image viewing. MCP image content may be materialized by Antigravity as an image file opened by its native viewer. Do not mistake a prompt restriction for a runtime tool allowlist or an OS sandbox.

Both subprocesses receive a limited environment excluding Worker and database credentials, while retaining their own provider authentication. Runtime executables and tools run with the host user's filesystem privileges. Coordinator-accepted responses determine completion; an exit code of zero or a final assistant message alone cannot produce a successful annotation. Each runtime is stopped after its own proposal has been durably accepted, even if it would continue talking. Cancellation and lease loss take precedence over collection.

## Records and files

`annotation_runs` stores immutable requests, the frozen assignment (classes, instructions, region, agent name), the starting boxes, Worker ownership, lease, progress, and the compact validated result in Postgres. A review joins the newest successful run as the image's proposal and the newest run of any state as its activity. Image bytes remain in the existing content-addressed blob store. The run's image reference participates in image retention. The proposal is independent of `annotations`, which continues to hold the accepted review used by training snapshots.

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

Region settings belong to the model: 512-pixel cores, 32-pixel context, and native-size display (1×) by default, adjustable through the `update-model-annotation` agent operation. Each run freezes the model's settings of that moment into its assignment. A 3072×4096 image has 48 regions at 512 or 192 at 256. An initial supervised run uses one independent session per region; completed regions are reused during explicit standalone resume. These are workload choices, not measured accuracy guarantees.

Context is additional source-image area, clipped at image boundaries. A full interior 256-pixel core with 32-pixel context and 4× magnification is displayed as 1280×1280; a standalone crop restricted to 256×256 cannot include outside context and displays as 1024×1024. Magnification does not add source pixels or change the covered area. Original dimensions and scaling remain explicit in every task. Existing saved model settings and frozen runs retain their explicitly stored scale; the new default applies to new settings. Runtime image handling can resize or re-encode even native-size images: Pi 0.85.1 defaults to a 2000-pixel side and an encoded-byte limit. Inspect actual image delivery when comparing sizes; normalized coordinates need no pixel-scale multiplication. Glare, touching bodies, and uncertain extents must be evaluated visually; protocol validation cannot establish precision or recall.

## Ownership and failure semantics

The existing Worker bearer realm protects annotation claim/image/progress/lease/completion endpoints. Browser actions require the normal authenticated session. A request ID is idempotent only for the same creator and frozen input; one image/model can have at most one active run. A replayed claim returns the same assignment.

A live lease belongs to one Worker session. Cancellation, expiration, and session replacement prevent late progress or completion from becoming accepted results. Completion retries with the same payload and original owner are idempotent. Lease expiration fails explicitly; there is no automatic cross-host restart, shared checkpoint service, or hidden paid retry. A completed local payload can be uploaded again after an uncertain transport response. After a local crash, the Worker delegates export recovery to `recover_annotation`. That operation owns input validation, coordinator state, and export; it accepts no runtime and only exports a fully accepted run. The Worker does not interpret coordinator files. Partial work stays available for inspection; standalone `annotate run --resume` is an explicit request to retry unfinished regions, while product retries require a new request.

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
- `agent_annotation/runner.py`: bounded per-region sessions, explicit resume, export-only recovery, cancellation and collection.
- `agent_annotation/coordinator.py`: sole local owner of attempt lifecycle and durable result acceptance.
- `agent_annotation/tools.py`: common model-facing tool operations and their invoke/MCP transports.
- `worker/annotation.py`: authenticated assignment, image download, leases, and result upload.
- `web/src/domain/annotation-runs/`: product and transport contracts.
- `web/src/server/annotation-runs/`: durable run lifecycle and proposal validation.
- `web/src/features/calibration/AiAnnotate.tsx`: the annotation menu, the inspector's proposal section, and the batch dialog.

A future Codex or Claude Code adapter implements process execution against the same portable annotation package and completion rules. Runtime-specific CLI events stay out of annotation geometry, product persistence, and calibration state. Runtime construction is explicit; no dynamic plugin registry is required.


## Local execution ownership

The prepared image package is shared read-only. `annotation_view` reads only the bound region's assets and full-image locator; `annotation_preview` renders into that attempt's private directory. Proposal content is addressed by digest; a new proposal creates a new version.

One coordinator per run owns attempt lifecycle and acceptance. Tools reach it through a private Unix socket, submitting `taskId`, `attemptId` and `proposalId`; the socket's server serializes validation and short durable state changes, while image decoding and rendering happen in the tool processes. The MCP transport remains stdio, and the tool schema is the same in every session; the bound configuration and the coordinator enforce which region a session may touch.

Every task is running, accepted or failed. `state.json` is atomically published and contains the accepted response itself, so a mutable proposal file cannot change an accepted result, and a lost acknowledgement is replayed idempotently. Progress derives from acceptance events, which reopening a run rebuilds from `state.json`; a task still running when its supervisor left is reopened as failed. Replaced and cancelled attempts are fenced by attempt identity. The only file lock selects the run's one coordinator; agents, previews and status readers read published documents.

A failed session stops further dispatch while the sessions already running finish, so their acceptances remain for an explicit resume. Geometry and ownership across halo overlaps are decided at collection, and potential seam duplicates are reported for review; a seam review is a new region operation over the frozen source and prior results.

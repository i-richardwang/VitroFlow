# AI annotation

VitroFlow serves visual annotation through one authenticated MCP endpoint,
`/api/mcp`. Interactive clients and Worker-launched agents use the same image,
preview, submission, geometry and persistence implementation. VitroFlow supplies
tasks and validates proposals; the connected agent supplies visual reasoning.

## Product workflow

An image/model can have detector results, an AI proposal and an accepted human
review. The review takes precedence over the proposal, which takes precedence
over detection. Only a human review makes the image eligible for training.

On an image, **AI annotation** either starts from clean pixels or refits the boxes
currently shown. Model settings own classes, instructions and region geometry.
The server freezes those inputs at creation. Dataset and observation batch actions
queue one run per eligible image. Workers advertise Pi and Antigravity; a queued
run can be claimed by any Worker providing its requested runtime.

An interactive MCP client can create the same kind of proposal without an online
Worker. Its executor is recorded as `interactive`; the server does not pretend to know the
client's hidden model identity. Both paths appear in the existing proposal and
review UI, and neither writes an accepted human review automatically.

## One service, two principals

| Principal | Authentication | Tools | Scope |
| --- | --- | --- | --- |
| Interactive client | User OAuth at the existing MCP resource | `annotation_start`, `annotation_next`, and the three core tools | The user's own interactive runs |
| Worker-launched agent | Signed, short-lived task bearer token | The three core tools only | One run, region and attempt |

The authenticated per-request MCP factory constructs the tool list. Every core
operation independently checks task ownership and state, so hiding tools is not
the authorization boundary. Task credentials cannot call ordinary experiment or
model tools. User clients retain the existing business tools.

Task credentials have a distinct token prefix, signed audience, two-hour expiry,
and run/task/attempt binding. They are valid only while the Worker session and run
lease remain current. Replacing an attempt or cancelling the run fences old
credentials. An accepted submission can be replayed with the original credential
until its expiry; a different proposal cannot overwrite it. Worker credentials
never enter model prompts or runtime environments. The local credential file is
private and removed when the regional session exits.

## Tool contract

`annotation_start({requestId, ref: {digest, modelId}, input?})` creates an
interactive run. `requestId` is a caller-generated UUID; retrying it with identical
inputs returns the same run. `input` is an optional complete source-coordinate
reference list. Omitting it starts from the image alone.

`annotation_next({runId})` returns progress and the current unfinished `taskId`.
Calling it again before submission returns the same task. A null task ID indicates
completion. Run IDs can be used in a later conversation to resume after interruption.

The core schemas are identical for both principals and are also generated into
Python's standalone tool contracts:

- `annotation_view({taskId})` returns rules, classes, a full-image location overview,
  CLEAN, and optional numbered INITIAL references. Task identifiers are
  server-issued and must be used verbatim.
- `annotation_preview({taskId, instances, issues?})` validates the complete proposal,
  stores an immutable version, and returns `proposalId`, CLEAN and PROPOSED images.
  Instances have `id`, `class`, `box_2d`, and optional `uncertain`/`truncated` flags.
  Coordinates are `[ymin, xmin, ymax, xmax]`, normalized to 0–1000 relative to CLEAN.
- `annotation_submit({taskId, proposalId})` durably accepts exactly the previewed
  proposal. Changed geometry requires a new preview. Empty regions still submit an
  empty instance list. The final accepted region automatically completes the run.

Images are MCP image content containing PNG bytes, not authenticated download URLs.
Only the service reads canonical AVIFs from the existing blob store. The default
512-pixel core, 32-pixel halo and 1× display preserve native region detail; the
location overview is limited to a 1024-pixel longest side. Display magnification
changes presentation, not final coordinates. Runs are limited to 4096 regions;
increase core size for larger images.

A connected client must actually deliver MCP image content to its vision model.
Displaying an image in the chat UI alone does not verify that behavior. Real
ChatGPT or other hosted-client image handling and continuous tool execution must
be smoke-tested in that client. The service does not assume that one conversation
will process an entire dataset without interruption.

Example instruction after connecting a client:

> Use VitroFlow to annotate image DIGEST for model MODEL. Create an annotation run,
> get its next region, view every returned image, follow the model's rules, preview
> the complete boxes, inspect and correct them, and submit the previewed proposal.
> Continue until annotation_next returns no task. Save the result as an AI proposal.

## Worker responsibilities

The Worker claims runs and renews its existing lease. It probes the selected
runtime once, obtains the server's regional task list, and schedules up to two
independent sessions concurrently. Before each session it requests a task-bound
credential. Runtime/version/model provenance is frozen by the first assignment;
later sessions must match it.

Pi's native extension and Antigravity's stdio entry are thin transports to the
same remote MCP endpoint. The bridge fetches tool definitions from that endpoint
and forwards calls and image replies. It does not render, validate geometry,
checkpoint results or upload a whole-image document. Server acceptance determines
completion, including when an agent loses the submission reply or keeps talking.
The supervisor polls accepted state and stops completed sessions.

Install/authenticate Pi (`pi`) or Antigravity (`agy`) on the Worker host, then:

```bash
vitroflow annotate setup --runtime antigravity  # only for Antigravity
vitroflow worker setup annotator \
  --server https://your-workbench.example \
  --annotation-runtime pi \
  --annotation-runtime antigravity
```

Each enabled runtime has one private `config.toml` entry:

```toml
[[annotation]]
runtime = "pi"
# model = "provider/model"
# executable = "/absolute/path/to/pi"

[[annotation]]
runtime = "antigravity"
# model = "model-slug"
# executable = "/absolute/path/to/agy"
# timeout_seconds = 1800
```

Run `vitroflow worker doctor annotator` and restart after changing settings.
Antigravity setup registers the task-bound stdio bridge in its global MCP config;
it opens no listening port. An unrelated session without a binding has no tools.
Pi exposes only the annotation tools. Antigravity retains its native permissions
and viewer. The bridge is a transport adapter, not another annotation service.

Worker artifacts contain private regional prompts and runtime logs under
`<work-dir>/annotations/<run-id>/<attempt-id>/`. There is no downloaded source
image, local product checkpoint package or final upload payload. Standalone
`vitroflow annotate run` remains an independent offline file workflow described in
[autoannotation.md](autoannotation.md); it owns local execution, checkpoints and export recovery.

## Persistence and failure semantics

Postgres is the single authority:

- `annotation_runs`: frozen input, creator, selected executor, Worker lease,
  aggregate progress, execution provenance and final proposal.
- `annotation_tasks`: frozen core/patch geometry, current attempt and accepted
  regional response.
- `annotation_previews`: immutable proposal versions bound to a regional attempt.

Rendering happens outside acceptance transactions. Short transactions serialize
run changes, validate authorization and geometry, accept a region and update
progress. Concurrent final submissions cannot complete a run twice. Worker/session
locks follow the same order as claiming. Source-coordinate boxes are owned by the
half-open core containing their centers; halo context is not duplicated into
neighboring results. Owned boxes touching internal patch edges are rejected.
Uncertainty, boundary truncation and seam-review warnings remain in the proposal.
Geometry validation does not establish visual accuracy.

Interactive runs persist across conversation interruptions until completed or
cancelled. Worker lease loss fails explicitly; execution failures stop new
sessions while already running sessions finish. No automatic paid retry or
cross-runtime fallback occurs. A transport retry of an accepted proposal is
idempotent and does not rerun inference. A new product run is required after a
failed/cancelled run.

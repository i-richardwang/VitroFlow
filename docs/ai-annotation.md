# AI annotation

VitroFlow serves visual annotation through one authenticated MCP endpoint,
`/api/mcp`. Interactive clients and Worker-launched agents use the same image,
preview, submission, geometry and persistence implementation. VitroFlow supplies
tasks and validates proposals; the connected agent supplies visual reasoning.

## Product workflow

An image/model can have detector results, an AI proposal and an accepted human
review. The review takes precedence over the proposal, which takes precedence
over detection. Only a human review makes the image eligible for training.

A run has two inputs besides the image. Its **input** is the boxes it begins
from: none, so the agent draws from clean pixels, or a set of boxes it refits.
Its **scope** is the part of the image it redraws: the whole image, or only the
regions some source-pixel boxes touch, in which case every other region keeps
its input boxes. When beginning from an AI proposal, untouched regions also keep
their uncertainty and issues. The touched regions are replaced in full, including
their associated notes. On an image, **AI annotation** redraws the whole image from
clean pixels or from the boxes shown. Model settings own classes, instructions
and region geometry. The server freezes all of these at creation. Dataset and
observation batch actions queue one run per eligible image. The actions appear
only while some online Worker runs an annotation agent, and a request never
names one: any such Worker claims the oldest queued run.

An agent a person connects over MCP, such as ChatGPT, can create the same kind of
proposal from its own conversation, without an online Worker. The run is recorded
as `interactive`. Pages show both as the same AI proposal and AI activity, and
neither writes an accepted human review automatically.

An image and model have at most one run in progress, whoever drives it, so the
image is the run's address. Accepted regions are durable; who is working on a run
only decides who continues it. An interactive run stays open to the person who
started it until every region is accepted or it is cancelled, and any agent that
person connects, in any conversation, continues it. A Worker holds the run it
claims under a lease it renews; when the lease lapses, the run returns to the
queue with its accepted regions and the next Worker annotates only the rest. A
run fails only when its agent reports an error.

## Administration

Each Worker runs at most one annotation agent, chosen in its profile (see
[Worker responsibilities](#worker-responsibilities)). Administrators decide on the
Integrations page whether connected agents may annotate. Turned off, OAuth clients
no longer see the annotation tools and open interactive runs are cancelled; their
other MCP tools are unaffected.

## One service, two principals

| Principal | Authentication | Tools | Scope |
| --- | --- | --- | --- |
| Interactive client | User OAuth at the existing MCP resource, while interactive annotation is enabled | `annotation_read`, `annotation_start`, `annotation_next`, `annotation_cancel`, and the three core tools | The user's own interactive runs |
| Worker-launched agent | Signed, short-lived task bearer token | The three core tools only | One run, region and attempt |

The authenticated per-request MCP factory constructs the tool list. Every core
operation independently checks task ownership and state, so hiding tools is not
the authorization boundary. Task credentials cannot call ordinary experiment or
model tools. User clients retain the existing business tools.

Task credentials have a distinct token prefix, signed audience, two-hour expiry,
and run/task/attempt binding. They are valid only while the Worker session and run
lease remain current. Replacing an attempt, releasing the lease or cancelling the
run fences old credentials. An accepted submission can be replayed with the
original credential until its expiry; a different proposal cannot overwrite it.
Worker credentials never enter model prompts or runtime environments. The local
credential file is private and removed when the regional session exits.

## Tool contract

`annotation_read({ref: {digest, modelId}})` returns how the image is annotated
for the model right now: the reviewer's boxes, the AI proposal and the detection
as source-coordinate instances, which of them the image reads by, and any run
still at work. It is the view to consult before redrawing part of an image.

`annotation_start({ref: {digest, modelId}, input?, scope?})` starts an
interactive run. `input` is the boxes the run begins from: a complete
source-coordinate list, the name of one of the image's readings (`"review"`,
`"proposal"` or `"detection"`, as `annotation_read` lists them) taken as it stands
when the run is admitted, or nothing to start from the image alone. Naming a
reading the image lacks is refused. `scope` is an optional list of
source-coordinate boxes `{x, y, width, height}`; the run then covers only the
regions those boxes touch, and every other region keeps its `input` boxes in the
result. With `input: "proposal"`, the run also freezes its uncertainty and issues
and carries those of untouched regions into the result. This is a whole-region
redraw, not an edit restricted to the exact scope rectangle. A scoped run requires
`input`, and a scope touching no region or leaving the image is refused. While the
image has a run in progress, starting another is refused with that run's progress.

`annotation_next({ref})` returns progress and the `taskId` of the first region of
the image's run still waiting for an answer. It returns the same region until that
region is accepted, so a run interrupted in one conversation continues in another.
It is refused when the image has no run in progress, or when the run in progress
belongs to a Worker or another person.

`annotation_cancel({ref})` cancels the person's run in progress on the image and
discards its accepted regions, so a new run can start with another input or scope.

The core schemas are identical for both principals and are also generated into
Python's standalone tool contracts:

- `annotation_view({taskId})` returns rules, classes, a full-image location overview,
  CLEAN, and optional numbered INITIAL references. Task identifiers are
  server-issued and must be used verbatim.
- `annotation_preview({taskId, instances, issues?})` validates the complete proposal,
  stores an immutable version, and returns `proposalId`, CLEAN and PROPOSED images.
  Instances have `id`, `class`, `box_2d`, and optional `uncertain`/`truncated` flags.
  Coordinates are `[ymin, xmin, ymax, xmax]`, normalized to 0–1000 relative to CLEAN.
  Preparation validates the response and projects its owned boxes into source
  coordinates for rendering. The immutable response is the content accepted by
  submission and projected into the final image. PROPOSED
  shows only the boxes this region owns and will save; halo-only boxes belong to
  neighboring regions. Preview and final collection use the same projection.
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

> Use VitroFlow to annotate image DIGEST for model MODEL. Start an annotation run
> unless one is already in progress, get its next region, view every returned image,
> follow the model's rules, preview the complete boxes, inspect and correct them, and
> submit the previewed proposal. Continue until annotation_submit reports the run
> succeeded. Save the result as an AI proposal.

## Worker responsibilities

The Worker probes its agent once when it starts and reports the result in its
heartbeat; a Worker whose agent cannot be probed keeps serving inference and
training. It claims runs and renews its lease, obtains the server's regional task
list, and schedules up to two independent sessions concurrently. Before each
session it requests a task-bound credential.

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
  --annotation-runtime pi
```

The agent is one private `config.toml` table:

```toml
[annotation]
runtime = "pi"                          # or "antigravity"
# model = "provider/model"
# executable = "/absolute/path/to/pi"
# timeout_seconds = 1800
```

Pi reaches other providers' models through `model`. The agent and its model belong
to the Worker's profile.

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

- `annotation_runs`: frozen input and scope, creator, executor (`worker` or
  `interactive`), the claiming Worker's lease, aggregate progress and final
  proposal.
- `workspace_settings`: whether connected agents may annotate.
- `annotation_tasks`: frozen core/patch geometry, current attempt and accepted
  regional response.
- `annotation_previews`: immutable proposal versions bound to a regional attempt.

Rendering happens outside acceptance transactions. Short transactions serialize
run changes, validate authorization and geometry, accept a region and update
progress. Concurrent final submissions cannot complete a run twice. Worker/session
locks follow the same order as claiming. Source-coordinate boxes are owned by the
half-open core containing their centers; halo context is not duplicated into
neighboring results. The same ownership decides which frozen input boxes a scoped
run carries into its result: those whose centers fall in a region it did not
redraw. Owned boxes touching internal patch edges are rejected.
Uncertainty, boundary truncation and seam-review warnings remain in the proposal.
Seam warnings are recomputed from the resulting boxes and exposed to both MCP
clients and the workbench. They ask for human review, never merge or delete boxes:
real objects can overlap. Frozen input notes, when present, describe the input
proposal; bare boxes carry no such assessment.
Geometry validation does not establish visual accuracy.

An interactive run stays open until completed or cancelled. A Worker lease loss
returns the run to the queue, retaining accepted regions; a new claim may execute
the unfinished regions again. Reported Worker execution failures stop new sessions
while already running sessions finish, then fail the run. Failed runs are not
automatically retried. A transport retry of an accepted proposal is
idempotent and does not rerun inference. A new product run is required after a
failed/cancelled run.

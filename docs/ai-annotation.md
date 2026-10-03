# AI annotation

VitroFlow serves visual annotation through its own MCP server,
`/api/annotation/mcp`, separate from the experiment MCP server at `/api/experiments/mcp`
(see [Agent API](agent-api.md)). An agent is configured with the server its job
needs: one that annotates images connects here, one that maintains experiments
connects there, and each is authorized on its own. A person's own agents and
Worker-launched agents use the same image, preview, submission, geometry and
persistence implementation. VitroFlow supplies tasks and validates proposals;
the connected agent supplies visual reasoning.

```bash
claude mcp add --transport http vitroflow-annotation https://<workbench>/api/annotation/mcp
```

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
their associated notes. On an image, **AI annotation** redraws the configured
annotation area from clean pixels or from the boxes shown. Model settings own classes, instructions
region geometry and the annotation area (`image` or `dish`). The server freezes
these settings and the resulting coverage at creation. Seed detection defaults
to `dish`; other models default to `image`. Dataset and
observation batch actions queue one run per eligible image. The actions appear
only while some online Worker runs an annotation agent, and a request never
names one: any such Worker claims the oldest queued run.

An agent a person connects to the annotation server, such as Claude or ChatGPT,
can create the same kind of
proposal from its own conversation, without an online Worker. The run is recorded
as `interactive`. Pages show both as the same AI proposal and AI activity, and
neither writes an accepted human review automatically.

An image and model have at most one run in progress, whoever drives it, so the
image is the run's address. Accepted regions are durable; who is working on a run
only decides who continues it. An interactive run stays open to the person who
started it until every region is accepted or it is cancelled, and any agent that
person connects, in any conversation, continues it. A Worker holds the run it
claims under a lease it renews; when the lease lapses, or the Worker restarts or
is removed, the run returns to the queue with its accepted regions and the next
Worker annotates only the rest. A
run fails only when its agent reports an error.

## Administration

Each Worker runs at most one annotation agent, chosen in its profile (see
[Worker responsibilities](#worker-responsibilities)). Administrators decide on the
Integrations page whether people's own agents may use the annotation server.
Turned off, the server refuses their requests with 403 and an explanation, and
open interactive runs are cancelled. Worker-launched agents and the experiment
server are unaffected.

## One server, two principals

| Principal             | Authentication                                                                  | Tools                                                                                                   | Scope                           |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------- |
| A person's agent      | User OAuth for the annotation resource, while interactive annotation is enabled | `annotation_read`, `annotation_start`, `annotation_next`, `annotation_cancel`, and the four core tools | The user's own interactive runs |
| Worker-launched agent | Signed, short-lived task bearer token                                           | The four core tools only                                                                               | One run, region and attempt     |

The authenticated per-request MCP factory constructs the tool list. Every core
operation independently checks task ownership and state, so hiding tools is not
the authorization boundary. The annotation server carries no experiment or model
tools, and the experiment server accepts neither task credentials nor OAuth
tokens bound to the annotation resource.

OAuth discovery follows RFC 9728: an unauthenticated request is challenged
toward `/.well-known/oauth-protected-resource/api/annotation/mcp`, which names
the workbench as authorization server, and tokens are bound to
`<BETTER_AUTH_URL>/api/annotation/mcp`. A client authorized for the experiment
server is asked for consent again before it can annotate.

OAuth resource requests use Better Auth's verifier for both Bearer and DPoP
access tokens. A DPoP-bound token requires the client's signed proof for the
request URL, method and access token; a reused proof is refused. The account and
client authorization are checked on every request, including after a valid proof.
Initialization uses the shared, retryable auth service rather than caching a
second MCP-specific initialization promise.

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

- `annotation_context({taskId})` returns a stable `contextId`, the frozen image,
  classes, rules, layout, scope and frozen coverage, and one unmarked whole-image OVERVIEW.
  `contextId` is the run identity: its definition is frozen, so every region of
  that run uses the same context. Load it at conversation start, when the context
  changes, and after context loss or compaction. A client may explicitly reload
  it at any time; the server does not track which conversations have seen it.
- `annotation_view({taskId})` returns `contextId`, regional source geometry,
  CLEAN, and optional numbered INITIAL references. It does not repeat the
  overview or shared rules. Core and patch rectangles are original image pixels;
  proposal coordinates remain normalized to CLEAN. Task identifiers are
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
shared overview is limited to a 1024-pixel longest side. Display magnification
changes presentation, not final coordinates. Runs are limited to 4096 regions;
increase core size for larger images.

The image asset module prepares regional evidence on first access in both
annotation area modes, outside database transactions. A cold preparation decodes
the canonical AVIF once and uses those pixels for lossless PNG regions and an
unmarked base overview. A scoped or dish run prepares only the regions it assigns;
their assets are shared with whole-image runs. Region geometry is shared with task
planning; rules, initial boxes and proposals are not part of the image assets.
The source digest, core size, halo, display scale and renderer version identify
reusable assets in the existing blob store, including after a server restart.
A completion receipt identifies an asset plan. Incomplete preparations reuse
finished images and resume the same preparation path.

Ingestion, analysis and image preparation share one process-wide slot, acquired
before loading an original for regional preparation. A 32 MiB LRU retains encoded
evidence, not decoded originals. Context reads the overview; views and previews
read CLEAN. Reference and proposal overlays use a separate 16 MiB LRU and at most
two concurrent renders. Decoder and render working memory are additional to these
cache budgets. Authorization and task state are checked even on cache hits.
Collection removes derived assets when their source Image is no longer rooted.

Dish detection runs in one lazy compute thread per process using pinned OpenCV.js
4.12 WASM. Ingestion analyzes the final canonical AVIF bytes, including canonical
imports, and records completed analysis in `images.dish_analysis`. Only an RGB
thumbnail with longest edge at most 1200 pixels crosses the thread boundary.
Image encoding, digest and source coordinates remain unchanged. Canonicalization
and analysis are separate bounded operations; analysis intentionally reads the
pixels of the stored encoding. No remote Worker is required.

One shared `image_geometry/dish-recipe.json` supplies Hough parameters and coverage
policy to both runtimes, validated against the generated `dish-recipe` contract.
The server uses Sharp Lanczos3 and OpenCV.js; native Python uses OpenCV INTER_AREA.
They share parameters and half-up thumbnail dimensions, but can produce slightly
different circles. The server's analysis identity contains detection parameters,
preprocessing and one explicit implementation revision. The shared JSON stores
parameters without a separate version number. Parameter changes alter the analysis
identity automatically. Dependency version inventories and the task coverage
margin are excluded. Advance the implementation revision for behavior changes
not represented by detection parameters, including relevant changes found when
reviewing dependency upgrades. Ordinary library upgrades alone do not invalidate
the corpus. Radius validation allows
one thumbnail pixel of tolerance around the integer Hough bounds.

Coverage expands the detected radius by 15%. A core is omitted only when its
rectangle is wholly outside that coverage; crossing and tangent cores remain.
Grid IDs, patches, halos and box ownership stay unchanged. Evidence and boxes are
never masked or clipped to the circle. `scope` intersects coverage and retains its
redraw semantics. Unassigned cores keep the input boxes, uncertainty and issues;
human reviews are never overwritten. Progress counts assigned tasks.

Completed analysis stores its recipe identity and circle. A null circle means
successful analysis with no candidate; null analysis means unavailable. Repeated
uploads reuse current completed results. Run admission reads metadata in one
transaction, freezes coverage and tasks, and performs no image I/O, detection or
PNG preparation. Missing, obsolete, no-candidate or invalid-circle analysis keeps
full-image coverage; admission logs its reason with the image and run IDs.
Analysis refreshes and model settings never alter an existing frozen run.

The maintenance process automatically refreshes unavailable or obsolete analysis.
It analyzes up to two images serially, then waits 30 seconds. Blob collection runs
on its own hourly cadence; infrastructure failures back off for one minute without
stopping the other responsibility. Maintenance uses one Sharp processing thread
and its own compute runtime: its resource budget is separate from the workbench,
not a shared cross-process gate. Compose and the Zeabur template include this
process as an application service, using `bun dist/maintenance.js` and the shared
database and blob-store environment.
Deploy workbench and maintenance from the same source commit; image-based
deployments use the same image digest for both roles. Maintenance has no public
port or browser authentication settings. Existing Zeabur projects must add this
service explicitly: updating a template does not modify deployed projects.

`images.dish_analysis_attempted_at` durably records each analysis attempt.
Maintenance prioritizes never-attempted images, then the oldest eligible attempts,
with a 15-minute retry interval. Each claim commits in a short transaction using
[`FOR UPDATE SKIP LOCKED`](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE);
decoding holds no database locks. Result writes are fenced by the attempt
timestamp and cannot replace newer analysis. Missing or corrupt
images fail individually and do not block later images. Database and object-store
transport failures reach infrastructure backoff. Completed no-candidate results
are not retried. Shutdown finishes the current image before stopping.

From the built Web application, `bun run images:analyze [batch-size]` performs one
finite sweep of eligible images, using batches of 100 by default (maximum 1000).
A fixed attempt cutoff excludes every image tried during the sweep, even if a
long sweep outlasts its retry interval. Recent attempts remain in cooldown. The
command reports examined, completed, failed and skipped counts. Completed means
analysis was persisted; skipped means a newer result or image deletion made the
write unnecessary. Every attempt satisfies
`examined = completed + failed + skipped`. Image failures or interruption produce
a nonzero exit status; skipped results do not. It uses the same canonical pixels
and detector as ingestion; routine corpus refresh does not require repeated
manual batches.

The repository maintains one current initial database schema. Existing
installations require a separate database operation before deploying a changed
schema; startup does not upgrade an initialized database by reapplying the
baseline. Preserve task plans, progress and annotations during that operation.
Analysis maintenance populates current results without modifying frozen runs.

A conversation handling multiple regions loads shared context once, then loops
through next, view, preview and submit. It reloads context whenever the region's
`contextId` changes or the previous context is no longer available. A newly
launched agent always loads it, including an agent resuming a partially completed
run. Task credentials authorize context through their assigned region, without
opening other regions. Context access performs the same ownership, attempt,
expiry and lease checks as region access, including cached asset reads. Context
loading is read-only and does not advance the run. No server-side seen-context
flag can describe what remains in a model's conversation.

For 20 fresh regions with one preview each, this flow delivers one overview,
20 CLEAN views and 40 preview images, instead of 20 overviews and 60 regional
images. This counts image messages, not model tokens. Worker scheduling still
launches one independent conversation per region; each loads its own context.

A connected client must actually deliver MCP image content to its vision model.
Displaying an image in the chat UI alone does not verify that behavior. Real
ChatGPT or other hosted-client image handling and continuous tool execution must
be smoke-tested in that client. The service does not assume that one conversation
will process an entire dataset without interruption.

Example instruction after connecting a client:

> Use VitroFlow to annotate image DIGEST for model MODEL. Start an annotation run
> unless one is already in progress and get its next region. Call annotation_context
> at conversation start and follow its classes and rules. Reuse that context across
> regions with the same contextId; reload after switching contexts or context loss.
> For each region, call annotation_view and inspect every returned image, preview
> the complete boxes, inspect and correct them, and submit the previewed proposal.
> Continue until annotation_submit reports the run succeeded. Save the result as
> an AI proposal.

## Worker responsibilities

The Worker probes its agent once when it starts and reports the result in its
heartbeat; a Worker whose agent cannot be probed keeps serving inference and
training. It claims runs and renews its lease, obtains the server's regional task
list, and schedules up to two independent sessions concurrently. Before each
session it requests a task-bound credential.

Pi's native extension and Antigravity's stdio entry are thin transports to the
same remote annotation server. The bridge fetches tool definitions from that server
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
Antigravity setup registers the task-bound stdio bridge in its global MCP config.
The bridge uses the Python MCP SDK v2 request handlers and supports both modern
discovery and the legacy initialization handshake used by existing stdio clients.
It opens no listening port. An unrelated session without a binding has no tools.
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
half-open core containing their centers. Neighbors read the same seam object
independently, so their centers can disagree; collection therefore reads every
region's boxes, halo context included, and treats boxes of one class from
different regions overlapping by IoU ≥ 0.5 as one object, at most one box per
region, strongest overlaps first. Each object yields one box: a retained input box
first, then a box its region owns, then a whole halo reading over a cut one. A
halo reading its owning region did not confirm is dropped. Issues follow the same
rule without classes. A scoped run reads the frozen input boxes of regions it did
not redraw (those whose centers fall there) as retained readings, so its seams
behave the same way. Overlaps within one region are never merged. Owned boxes
touching internal patch edges are rejected. Uncertainty and boundary truncation
remain in the proposal. Frozen input notes, when present, describe the input
proposal; bare boxes carry no such assessment.
Geometry validation does not establish visual accuracy.

An interactive run stays open until completed or cancelled. A Worker lease loss
returns the run to the queue, retaining accepted regions; a new claim may execute
the unfinished regions again. Reported Worker execution failures stop new sessions
while already running sessions finish, then fail the run. Failed runs are not
automatically retried. A transport retry of an accepted proposal is
idempotent and does not rerun inference. A new product run is required after a
failed/cancelled run.

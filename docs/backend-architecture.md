# Backend architecture

The backend is a modular monolith. Business modules own lifecycles; protocol adapters, cross-module page queries, maintenance, and infrastructure have separate homes. It has four boundaries. Dependencies point inward; an inner layer does not describe an outer protocol.

```text
HTTP / MCP / worker routes
            │
            ▼
application operations and worker control planes
            │
            ▼
experiment, dataset, model, inference, and training domain services
            │
            ▼
database, immutable blob storage, and external runtimes
```

## Source map

`web/src/server/` and the framework entry `web/src/server.ts` are server-only, enforced by the Vite client import protection. `web/src/domain/` contains shared schemas and pure transformations; it never imports server implementations, UI, or localization. The complete runtime-capability map is described in [Architecture](architecture.md). Framework routes live in `web/src/routes/`, and Server Function adapters live in `web/src/functions/`.

| Server directory                    | Ownership                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `images/`                           | Canonicalization, immutable image storage, digest locks, and image collection                             |
| `experiments/`                      | Experiment design, observations, culture events, and observation image membership                         |
| `datasets/`                         | Dataset membership, review records, and import/export                                                     |
| `annotations/`                      | Current human annotations, optimistic replacement, and review documents                                   |
| `inference/`                        | Image/version jobs, leases, canonical outcomes, and latest successful detection queries                   |
| `training/`                         | Runs, frozen training snapshots, epochs, publication, and weight collection                               |
| `models/`                           | Models and immutable version registration                                                                 |
| `workers/`                          | Worker roster, process sessions, and heartbeat presence                                                   |
| `auth/`                             | Accounts, API keys, OAuth clients, and live authorization checks                                          |
| `agent/`                            | Protocol-neutral operation catalog and execution boundary                                                 |
| `queries/`                          | Cross-module page projections: dataset overview, training console, system status, and image display names |
| `transport/http/`, `transport/mcp/` | Request parsing, protocol responses, authentication gates, and locale/session adapters                    |
| `maintenance/`                      | Composition of resource collectors                                                                        |
| `infra/`                            | Database mechanics, shared database schema, blob drivers, digests, and deployment configuration           |
| `bootstrap.ts`                      | Application database initialization and builtin model installation                                        |
| `testing/`                          | Cross-module test fixtures; production never imports them                                                 |

Business modules and `queries/` expose a small `public.ts`. Cross-module callers import that entry; files inside a module import their siblings directly. Public entries export specific operations and contracts, not every internal function. Infrastructure capabilities and protocol adapters use explicit file entry points instead of an all-purpose barrel.

`bun run architecture:check`, also part of `make check-web`, parses imports and re-exports, including type-only and literal dynamic imports. It checks public entry points, permitted dependency directions, browser/server separation, test isolation, and both file and module cycles. The allowed dependency graph lives in `web/scripts/architecture.ts`. Adding a new server module requires an explicit ownership decision there.

Cross-module page queries depend on business modules; business modules never depend on those pages. For example, `queries/dataset-overview.ts` combines dataset records and training state, so datasets do not depend back on training. Dataset review records remain in `datasets/` because both dataset transfer and training snapshot creation consume them. Image display names live in `queries/`: filenames belong to observation or dataset memberships, never to the global image asset.

Modules use Drizzle directly. The shared foreign-key graph lives in one schema, and cross-table reads use joins. Multi-module writes share an executor and acquire locks in a consistent order. Import boundaries complement database ownership rules, constraints, and concurrency tests.

## Agent control plane

`agent/operations.ts` is a protocol-neutral catalog. An entry declares a query or command, whether a command is destructive, its input/output contracts, and its handler. `agent/execution.ts` is the production execution boundary for Agent calls: it parses input once, runs a command and validates its output in one transaction, and classifies failures after rollback. Queries use the same input and output contracts without a write transaction.

HTTP maps failure codes to status codes. MCP derives tool annotations and formats tool errors. Neither choice leaks back into the catalog. A failed command leaves the record as it was.

## Worker control planes

One credential opens the worker realm. A worker ID names a configured worker, while a fresh session ID fences one process incarnation from another. The `workers` roster holds one row per worker: its current session, the runtimes it executes, the memory it offers, and when it was last heard from. Presence is the heartbeat age; what a worker is doing is the lease it holds, never a second copy in the roster.

Inference is a queue, not a snapshot query. A worker atomically claims one demanded image/version pair in `inference_jobs` and renews its lease while loading and predicting. Completion atomically consumes an unexpired lease owned by the current worker session in the same transaction that stores the outcome. The immutable `inference_outcomes` row remains the business record.

`inference/jobs.ts` owns claim orchestration and calls `inference/outcomes.ts` with the same executor when completing a job. Outcomes never depend on the queue orchestrator. `training/runs.ts` owns run state transitions; `training/publication.ts` validates and publishes artifacts using those transitions. Publication and collection remain under training because a training attempt determines the weight object's lifetime.

Production inference results enter through lease completion. Tests seed outcomes through `testing/inference.ts`; this fixture is outside the production module graph. Collection and outcome tests live alongside the image and inference modules that own those rules.

Training shares the roster and its ownership vocabulary—worker, session, lease, and attempt—but keeps its own run state machine because epochs and publication belong to a durable training run. Both claims lock the worker row, and every owned write carries the predicate that the session is still the roster's. A worker process serves both queues, taking a training run first when it advertises the ultralytics runtime, so the runtimes a session heartbeats are the whole of what it will do. The process owns the accelerator lifecycle: it releases the cached inference model before training and collects runtime allocations when training exits. Consecutive inference tasks may reuse the cached model.

## Wire contracts

Zod schemas in the Web package are authoritative for documents shared with Python. `web/scripts/generate-contracts.ts` emits JSON Schema into `src/vitroflow/contracts`. Python validates that shared structure first, then its small decoders construct domain objects and enforce cross-field semantics. `make check` fails when generated schemas are stale.

## Persistence and startup

`infra/db/connection.ts` knows drivers, pools, and raw connections. `infra/db/client.ts` owns the process connection and transaction helpers. `bootstrap.ts` supplies its initializer: it migrates a connection and installs builtin models before publishing the shared handle, closing the connection if preparation fails. Model reads and immutable registration live in `models/registry.ts`; operations accept an executor to join an existing transaction. Bootstrap calls the public `installBuiltinModels` operation with the connection being prepared.

The framework server entry, both maintenance scripts, and the test preload call `bootstrap()`. Wiring is synchronous; the connection opens on first use, survives hot reload, and remains retryable after failure. A process entry point calls bootstrap before using application services. The one-shot collector closes the connection in `finally`; long-running server and maintenance processes keep it for their lifetime. Importing a business module or the migration schema does not open a connection.

Database checks, foreign keys, uniqueness constraints, advisory locks, immutable blob keys, and digest verification are intentional last-line invariants. They protect alternate writers and concurrency and should not be replaced with request validation alone.

The blob driver only knows object keys and immutable bytes. `images/keys.ts` and `training/keys.ts` own their respective key formats. `images/lock.ts` coordinates writes and references to each digest. `images/collection.ts` first expires unreferenced database rows, then sweeps objects under that lock; `training/collection.ts` checks the active attempt and published version under the run lock. `maintenance/collection.ts` invokes both collectors. Collection runs outside request handling and upload transactions.

## Security boundary

API keys, MCP OAuth, browser sessions, and worker tokens authenticate different principals. MCP access is rechecked against the account, client, consent, protected resource, and originating browser session on every request so revocation is immediate. Authorization is decided at the adapter and answers only whether the request may proceed; the operation catalog runs without an identity.

## Module rule

Split a module when it owns more than one lifecycle, not merely because it is long. Schema tables remain together while their foreign-key graph is the useful unit. Worker wire documents are separate from worker orchestration, and connection mechanics are separate from application bootstrap. New protocol adapters should project existing application operations rather than add a second execution path.

## Calibration

An annotation is one current document per image and model. Opening a calibration reads the current annotation independently of the route cache. The session owns those original stored boxes, its mutable draft, and undo/redo history; route refreshes do not replace them. Submission freezes all draft changes. The save request includes the original boxes (null for an unreviewed image); the annotation service holds the image lock while comparing that base with the current document and storing its replacement. A stale draft is refused and stays open. No revision history or concurrency metadata travels in dataset annotations.

The image viewport owns one transform shared by viewing and calibration. Automatic fill follows the frame dimensions; manual placement uses the same scale interval and offset bounds. The effective scale is resolved before calculating a wheel gesture's anchor, and covering the frame takes precedence over the manual magnification limit.

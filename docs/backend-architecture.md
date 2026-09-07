# Backend architecture

The backend has four boundaries. Dependencies point inward; an inner layer does not describe an outer protocol.

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
database repositories, immutable blob storage, and external runtimes
```

## Agent control plane

`agent-operations.ts` is a protocol-neutral catalog. An entry declares a query or command, whether a command is destructive, its input/output contracts, and its handler. `agent-execution.ts` is the only production execution boundary: it parses input once, runs a command and validates its output in one transaction, and classifies failures after rollback. Queries use the same input and output contracts without a write transaction.

HTTP maps failure codes to status codes. MCP derives tool annotations and formats tool errors. Neither choice leaks back into the catalog. A failed command leaves the record as it was.

## Worker control planes

One credential opens the worker realm. A worker ID names a configured worker, while a fresh session ID fences one process incarnation from another. The `workers` roster holds one row per worker: its current session, the runtimes it executes, the memory it offers, and when it was last heard from. Presence is the heartbeat age; what a worker is doing is the lease it holds, never a second copy in the roster.

Inference is a queue, not a snapshot query. A worker atomically claims one demanded image/version pair in `inference_jobs` and renews its lease while loading and predicting. Completion atomically consumes an unexpired lease owned by the current worker session in the same transaction that stores the outcome. The immutable `inference_outcomes` row remains the business record.

Training shares the roster and its ownership vocabulary—worker, session, lease, and attempt—but keeps its own run state machine because epochs and publication belong to a durable training run. Both claims lock the worker row, and every owned write carries the predicate that the session is still the roster's. A worker process serves both queues, taking a training run first when it advertises the ultralytics runtime, so the runtimes a session heartbeats are the whole of what it will do. The process owns the accelerator lifecycle: it releases the cached inference model before training and collects runtime allocations when training exits. Consecutive inference tasks may reuse the cached model.

## Wire contracts

Zod schemas in the Web package are authoritative for documents shared with Python. `web/scripts/generate-contracts.ts` emits JSON Schema into `src/vitroflow/contracts`. Python validates that shared structure first, then its small decoders construct domain objects and enforce cross-field semantics. `make check` fails when generated schemas are stale.

## Persistence and startup

`db/connection.ts` knows drivers, pools, and raw connections. `db/client.ts` is the application composition root: it migrates a connection and installs builtin models before publishing the shared handle. Model registration depends only on the driver-neutral executor type, keeping infrastructure independent of its application client.

Database checks, foreign keys, uniqueness constraints, advisory locks, immutable blob keys, and digest verification are intentional last-line invariants. They protect alternate writers and concurrency and should not be replaced with request validation alone.

## Security boundary

API keys, MCP OAuth, browser sessions, and worker tokens authenticate different principals. MCP access is rechecked against the account, client, consent, protected resource, and originating browser session on every request so revocation is immediate. Authorization is decided at the adapter and answers only whether the request may proceed; the operation catalog runs without an identity.

## Module rule

Split a module when it owns more than one lifecycle, not merely because it is long. Schema tables remain together while their foreign-key graph is the useful unit. Worker wire documents are separate from worker orchestration, and connection mechanics are separate from application bootstrap. New protocol adapters should project existing application operations rather than add a second execution path.

## Review editing

An annotation is one current document per image and model. Opening an editing session reads the current annotation independently of the route cache. The session owns those original stored boxes, its mutable draft, and undo/redo history; route refreshes do not replace them. Submission freezes all draft changes. The save request includes the original boxes (null for an unreviewed image); the annotation service holds the image lock while comparing that base with the current document and storing its replacement. A stale draft is refused and stays open for the reviewer. No revision history or concurrency metadata travels in dataset annotations.

The image viewport owns one transform shared by viewing and editing. Automatic fill follows the frame dimensions; manual placement uses the same scale interval and offset bounds. The effective scale is resolved before calculating a wheel gesture's anchor, and covering the frame takes precedence over the manual magnification limit.

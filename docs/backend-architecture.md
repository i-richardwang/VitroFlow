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

`agent-operations.ts` is a protocol-neutral catalog. An entry declares a query or command, whether a command is destructive, its input/output contracts, and its handler. `agent-execution.ts` is the only production execution boundary: it parses input once, classifies domain failures, validates output, and gives commands transactional idempotency and attribution.

HTTP maps failure codes to status codes. MCP derives tool annotations and formats tool errors. Neither choice leaks back into the catalog. A successful command and its domain change commit with one `agent_executions` row; failed commands leave neither a reservation nor an audit record.

## Worker control planes

Worker credentials authorize a role. A worker ID names a configured worker, while a fresh session ID fences one process incarnation from another.

Inference is a queue, not a snapshot query. A worker atomically claims one demanded image/version pair in `inference_jobs` and renews its lease while loading and predicting. Completion atomically consumes an unexpired lease owned by the current worker session in the same transaction that stores the outcome. The immutable `inference_outcomes` row remains the business record.

Training uses the same ownership vocabulary—worker, session, lease, and attempt—but keeps its richer run state machine because epochs and publication belong to a durable training run.

## Wire contracts

Zod schemas in the Web package are authoritative for documents shared with Python. `web/scripts/generate-contracts.ts` emits JSON Schema into `src/vitroflow/contracts`. Python validates that shared structure first, then its small decoders construct domain objects and enforce cross-field semantics. `make check` fails when generated schemas are stale.

## Persistence and startup

`db/connection.ts` knows drivers, pools, and raw connections. `db/client.ts` is the application composition root: it migrates a connection and installs builtin models before publishing the shared handle. Model registration depends only on the driver-neutral executor type, so infrastructure no longer imports back through its own application client.

Database checks, foreign keys, uniqueness constraints, advisory locks, immutable blob keys, and digest verification are intentional last-line invariants. They protect alternate writers and concurrency and should not be replaced with request validation alone.

## Security boundary

API keys, MCP OAuth, browser sessions, and worker tokens authenticate different principals. MCP access is rechecked against the account, client, consent, protected resource, and originating browser session on every request so revocation is immediate. The application receives only the minimal `{ kind, userId, credentialId }` principal after that adapter-specific authorization succeeds.

## Module rule

Split a module when it owns more than one lifecycle, not merely because it is long. Schema tables remain together while their foreign-key graph is the useful unit. Worker wire documents are separate from worker orchestration, and connection mechanics are separate from application bootstrap. New protocol adapters should project existing application operations rather than add a second execution path.

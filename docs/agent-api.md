# Agent API

The agent interface lets an AI agent maintain experiment records: design, observation dates, culture events, and image entry. It exposes the workbench domain layer directly, so every request is validated by the same schemas and rejected by the same invariants as the workbench UI.

One operation registry (`web/src/server/agent/operations.ts`) defines the interface. The HTTP surface and the MCP tool list are both projections of it; an operation name is part of the public contract.

## Authentication

The HTTP surface is opened by a personal API key with the **Agent interface** scope, issued under Integrations in the workbench and presented as a bearer token:

```
Authorization: Bearer vf_…
```

The agent acts as the account that issued the key. Every request resolves the current account and credential state, so revoking the key, suspending the account, or deleting the account denies the next request.

The MCP surface is opened by OAuth instead: see below.

## HTTP surface

| Request                     | Purpose                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /api/agent/operations` | Describe every operation: query/command kind, destructive flag, and input/output JSON Schemas |
| `POST /api/agent/<name>`    | Call one operation with its JSON input                                                        |
| `POST /api/agent/images`    | Store image bytes; the response is the digest assignment expects                              |

Every result is validated against the operation's published output schema before it leaves the workbench; for commands this validation must succeed before the transaction commits, so the discovery document is the contract on both sides of a call. A successful call answers `{"result": ...}`. A failed call answers `{"error":{"code":"...","message":"..."}}`; HTTP maps the protocol-neutral code to the status describing what the agent can do about it:

- `400` — the input does not satisfy the operation's schema; the message names the offending fields.
- `401` — the request presents no live API key with the agent scope.
- `404` — the operation or the addressed record does not exist.
- `409` — a domain rule rejected the request, such as deleting an observation that has images.
- `500` — a workbench defect; the body carries no detail, and the cause is in the server log.

```http
POST /api/agent/create-observation HTTP/1.1
Authorization: Bearer vf_…
Content-Type: application/json

{"experiment":"…","observedOn":"2026-09-02"}
```

Every record an agent can create is named by something it already knows: an experiment by its name, a treatment by its name within the experiment, an observation by its date, a unit by its code, an image by its digest. Repeating a create therefore answers 409 rather than making a second record, so a call whose response was lost is safe to send again.

Image upload posts the raw source bytes as the request body with an exact `Content-Length`, up to 64 MiB. The image is canonicalized on entry, and the returned digest identifies the canonical bytes; identical uploads are idempotent.

## MCP surface

`POST /api/experiments/mcp` is the experiment MCP server, serving MCP 2026-07-28 and 2025-06-18 Streamable HTTP clients. Its tools are exactly the operations of the registry. Drawing boxes on images is the job of the [annotation MCP server](ai-annotation.md), which an agent connects to and is authorized for on its own. Each tool carries the operation's input and output schemas and its behavior annotations, and a successful call returns the result as structured content. The MCP server validates arguments against the tool's input schema itself, so a call whose arguments do not fit is refused before the operation runs.

Both MCP servers use the official TypeScript SDK's `createMcpHandler` with
`legacy: "stateless"`, following its [legacy-client guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/legacy-clients.md)
and the specification's [dual-era versioning rules](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning).
Clients such as Codex that negotiate 2025-06-18 use `initialize`,
`notifications/initialized`, then tool requests with `MCP-Protocol-Version`.
2026-07-28 clients send protocol metadata on each request. The SDK handles
both lifecycles through the same per-request server factory, and
authentication runs before either lifecycle. No session identifier or server-side
session store is created. This compatibility mode does not enable the old
HTTP+SSE transport.

The workbench is the OAuth 2.1 authorization server for its MCP servers. A request without a valid access token answers 401 with a `WWW-Authenticate` challenge naming the protected resource metadata at `/.well-known/oauth-protected-resource/api/experiments/mcp`, from which a client discovers the authorization server, registers itself through a Client ID Metadata Document or dynamic registration, and sends the person to sign in and approve the connection. Tokens are bound to `<BETTER_AUTH_URL>/api/experiments/mcp`, so a token issued for the annotation server does not open this one. Every call also checks that the account, browser session, client, and consent remain active; disconnecting the client under Integrations denies its next call to either server. Host and browser Origin headers must name localhost or the `BETTER_AUTH_URL` hostname; non-browser MCP clients omit Origin, but their Host is still validated.

Both routes forward all HTTP methods to the MCP adapter instead of allowing
unhandled requests to fall through to page rendering. Host/Origin validation
and authentication run first: missing, invalid or revoked credentials receive
the OAuth challenge, including on GET probes. After authentication, only POST
is admitted; other methods receive `405 Method Not Allowed` with `Allow: POST`.
GET streams and DELETE sessions are not implemented.

This follows the [MCP 2026-07-28 transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
and [authorization discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery)
contracts. [Better Auth](https://better-auth.com/docs/plugins/mcp) owns OAuth
verification and challenges; the SDK owns POST exchanges. Its Next.js example
lets the framework reject unsupported methods before authentication. Here,
authentication precedes method rejection so login probes receive discovery
information through the same protected-resource boundary.

Codex can use its HTTPS client metadata document as `client_id`, as described
in the [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
The [Better Auth CIMD transport](https://better-auth.com/docs/plugins/cimd)
resolves DNS once, rejects non-public addresses, pins the connection to a
validated address, verifies TLS for the original hostname, and refuses
redirects. Keep the Better Auth packages together at 1.7.7 or later: the
1.7.2 Node transport returned a scalar DNS result even when HTTPS requested
an address array, causing `invalid_client` with “network error or redirect
blocked” before a connection was made.

Before deploying this upgrade over a database created with Better Auth
1.7.0–1.7.2, follow its [account upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide).
The repository maintains a single schema baseline; startup does not reapply
that baseline to an existing database. Check for duplicate account keys:

```sql
SELECT provider_id, account_id, count(*)
FROM accounts
GROUP BY provider_id, account_id
HAVING count(*) > 1;
```

Resolve any returned rows without merging different users. Then align the
existing schema before deploying the new packages:

```sql
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_account_idx
  ON accounts (provider_id, account_id);
ALTER TABLE accounts ALTER COLUMN issuer DROP NOT NULL;
DROP INDEX IF EXISTS accounts_issuer_account_idx;
COMMIT;
```

This retains account rows and legacy issuer values. New accounts no longer
write `issuer`; both new account creation and existing password sign-in must
work after alignment. Fresh databases already use this schema.

For Codex, configure each URL and log in separately:

```bash
codex mcp add vitroflow-experiments --url https://<workbench>/api/experiments/mcp
codex mcp add vitroflow-annotation --url https://<workbench>/api/annotation/mcp
codex mcp login vitroflow-experiments
codex mcp login vitroflow-annotation
```

Connect with:

```bash
claude mcp add --transport http vitroflow-experiments https://<workbench>/api/experiments/mcp
```

Image bytes do not travel through MCP. Upload them to `POST /api/agent/images` and pass the returned digest to `assign-images-to-observation`.

## Data-entry workflow

Entering one round of observation photos:

1. `get-experiment` reads the experiment grid: treatments, units with their codes, and existing observations.
2. `create-observation` adds the observation date, unless the grid already holds it.
3. `POST /api/agent/images` stores each photo and returns its digest.
4. `assign-images-to-observation` attaches the digests to units in that observation, keeping each source filename for traceability. A cell that already has an image is given the new one. Filenames may suggest unit codes, but the unit id in the assignment is authoritative.
5. `record-culture-event` records contamination or loss observed while photographing. Contaminated, discarded, and missing exclude the unit from analysis from that observation on; nonviable and harvested keep it included. `remove-culture-event` erases an event recorded by mistake.

Analysis needs no request: assigned images are queued for the newest version of their observation's model automatically, and `retry-observation-image-analysis` requeues one that failed. A model with no version queues nothing; its images wait for a reviewer, and `create-model` names such a model in the first place.

## Transactions

A command runs in one database transaction: it either changes the record as a whole or leaves it untouched. Image upload only stages immutable content by digest; assigning that content to an observation is the command that changes the record.

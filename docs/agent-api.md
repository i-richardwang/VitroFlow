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

`POST /api/mcp` serves MCP 2026-07-28. Each tool carries the operation's input and output schemas and its behavior annotations, and a successful call returns the result as structured content. Older MCP transports are not accepted. The MCP server validates arguments against the tool's input schema itself, so a call whose arguments do not fit is refused before the operation runs.

The workbench is the OAuth 2.1 authorization server for its own MCP endpoint. A request without a valid access token answers 401 with a `WWW-Authenticate` challenge naming the protected resource metadata at `/.well-known/oauth-protected-resource/api/mcp`, from which a client discovers the authorization server, registers itself through a Client ID Metadata Document or dynamic registration, and sends the person to sign in and approve the connection. Tokens are bound to `<BETTER_AUTH_URL>/api/mcp`. Every call also checks that the account, browser session, client, and consent remain active; disconnecting the client under Integrations denies its next call. Host and browser Origin headers must name localhost or the `BETTER_AUTH_URL` hostname; non-browser MCP clients omit Origin, but their Host is still validated.

Connect with:

```bash
claude mcp add --transport http vitroflow https://<workbench>/api/mcp
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

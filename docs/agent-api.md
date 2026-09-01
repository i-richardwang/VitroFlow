# Agent API

The agent interface lets an AI agent maintain experiment records: design, observation dates, culture events, and image entry. It exposes the workbench domain layer directly, so every request is validated by the same schemas and rejected by the same invariants as the workbench UI.

One operation registry (`web/src/server/agent-operations.ts`) defines the interface. The HTTP surface and the MCP tool list are both projections of it; an operation name is part of the public contract.

## Authentication

Every request carries the agent credential as a bearer token:

```
Authorization: Bearer <VITROFLOW_AGENT_TOKEN>
```

The token is a distinct role credential configured on the workbench. When it is unset, the agent interface is disabled and every request answers 401.

## HTTP surface

| Request                      | Purpose                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `GET /api/agent/operations`  | Describe every operation: input and output JSON Schemas plus behavior hints (read-only, destructive, idempotent) |
| `POST /api/agent/<name>`     | Call one operation with its JSON input                             |
| `POST /api/agent/images`     | Store image bytes; the response is the digest assignment expects   |

Every result is validated against the operation's published output schema before it leaves the workbench, so the discovery document is the contract on both sides of a call. A successful call answers `{"result": ...}`. A failed call answers `{"error": "..."}` with the status describing what the agent can do about it:

- `400` — the input does not satisfy the operation's schema; the message names the offending fields.
- `404` — the operation or the addressed record does not exist.
- `409` — a domain rule rejected the request, such as deleting an observation that has images.
- `500` — a workbench defect; the body carries no detail, and the cause is in the server log.

Image upload posts the raw source bytes as the request body with an exact `Content-Length`, up to 64 MiB. The image is canonicalized on entry, and the returned digest identifies the canonical bytes; identical uploads are idempotent.

## MCP surface

`/api/mcp` serves the same operations as Model Context Protocol tools, with the same bearer token. Each tool carries the operation's input and output schemas and its behavior annotations, and a successful call returns the result as structured content. Host and browser Origin headers must name localhost or a hostname listed in `VITROFLOW_MCP_ALLOWED_HOSTNAMES` (comma-separated, without schemes or ports). Non-browser MCP clients omit Origin, but their Host is still validated.

Connect with:

```bash
claude mcp add --transport http vitroflow https://<workbench>/api/mcp \
  --header "Authorization: Bearer $VITROFLOW_AGENT_TOKEN"
```

Image bytes do not travel through MCP. Upload them to `POST /api/agent/images` and pass the returned digest to `assign-images-to-observation`.

## Data-entry workflow

Entering one round of dish photos:

1. `get-experiment` reads the experiment grid: treatments, observation units with their codes, and existing observations.
2. `create-observation` adds the observation date, unless the grid already holds it.
3. `POST /api/agent/images` stores each photo and returns its digest.
4. `assign-images-to-observation` attaches the digests to observation units in that observation, keeping each source filename for traceability. Filenames may suggest unit codes, but the unit id in the assignment is authoritative.
5. `record-culture-event` records contamination or loss observed while photographing. When the request omits `excludeFromObservation`, the event type's default applies: contaminated, discarded, and missing exclude the unit from analysis; nonviable and harvested keep it included.

Analysis needs no request: assigned images are queued for the experiment's model version automatically, and `retry-observation-image-analysis` requeues one that failed.

## Boundary

The interface serves one trusted agent holding one credential. Requests carry no idempotency keys and no per-caller audit trail; opening the interface to multiple clients would require designing both first.

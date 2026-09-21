# Architecture

VitroFlow has a Web control plane and a Python client/worker package. Source boundaries describe the capabilities a module may use; each boundary is organized by the domain or lifecycle it owns. React components can render on the server, so a frontend directory does not authorize browser globals during rendering.

## Web source map

```text
web/src/
├── domain/       Shared contracts, invariants, and pure transformations
├── lib/          Isomorphic ZIP, canonical JSON, and HTTP JSON utilities
├── server/       Database-backed services and protocol adapters
├── functions/    Server Function adapters and RPC error mapping
├── features/     Complete user interactions, grouped by feature
├── ui/           Reusable presentation, layout, viewport, and hooks
├── routes/       File routes: loading, metadata, handlers, and composition
├── paraglide/    Generated localization runtime and messages
├── server.ts     Framework server entry and application bootstrap
└── start.ts      Request and function middleware
```

`domain/` and `lib/` do not import React, localization, frontend features, or server implementations, and do not access browser-only globals. Domain modules may use library utilities; libraries do not depend on domain modules. Domain schemas and transformations can be used directly by services, contract generation, or frontend features.

`features/` owns browser requests, form state, and interaction lifetimes. `ui/` may use domain types and display them, but never invokes a feature or Server Function. For example, the shell receives the signed-in account control as content; the account feature owns sign-out. File routes assemble these pieces. Both Server Functions and file-route HTTP handlers are valid service entry points.

The server module map and transaction rules are described in [Backend architecture](backend-architecture.md). Vite protects server files from client imports. `bun run architecture:check` additionally checks layer directions, pure-module capabilities, test isolation, all source-file cycles, and server public APIs. Imports, type imports, and re-exports participate in the rules. Dynamic imports must use literal paths.

## Shared rules and presentation

`domain/datasets/archive-format.ts` owns archive entry names and limits. `features/datasets/import-archive.ts` reads a browser archive, checks the destination, uploads its images, and applies the manifest. Services import the format without importing the browser workflow.

Image admission returns stable refusal codes. Training parameters, annotation configuration, and inference model manifests use authoritative Zod schemas. Forms derive bounds from those schemas and own only labels and interaction steps. Python validates against generated JSON Schema; standalone annotation also reads its defaults from that contract. Cross-field semantics remain with the domain that owns them.

Domain exceptions inherit shared categories from `domain/errors.ts` and carry stable codes. The Server Function boundary converts expected refusals to an explicit `business_failure` document containing its code, category, and declared JSON details; it does not rely on preserving an Error subclass across serialization. The UI validates and translates that document. Diagnostic messages remain English, and unexpected exceptions are logged and passed to the framework's error handling. HTTP and MCP adapters retain their explicit protocol mappings.

## Calibration lifetime

`features/calibration/ImageWorkbench.tsx` owns one `Workbench` and one `ImageViewport`. Calibration is session state on that frame: the same viewport stays mounted while the workbench loads the stored annotation, draws a draft, and returns to the stored review. Display layers, manual zoom, and pan survive the switch.

`domain/annotation/draft.ts` owns the pure annotation draft, undo/redo, and the submission freeze. The frame is idle until asked to calibrate, loading until the stored annotation matches this image and model, then a draft with shortcuts and leave-blocking. Draft instances begin from the displayed reading: review, AI proposal, or detections. The save base independently records the persisted review, so saving detects concurrent edits regardless of where the draft's boxes came from. Until the fetch completes, Save stays pending and the on-screen marks remain the current reading. A cancelled fetch or a different model must not inherit another review's baseline. The DOM lifecycle test performs wheel zoom and pointer panning, enters and leaves calibration, and verifies both the original image node and its transform remain intact.

## Python source map

```text
src/vitroflow/
├── cli.py
├── contracts/                  Generated schemas, validation, decoding helpers
├── annotations.py              Annotation documents and geometry
├── autoannotation/             Portable visual tasks, checkpoints, CLI, AI artifacts
├── agent_runtimes/             External process adapters
├── agent_annotation/           Supervised annotation execution
├── datasets/                   Manifests, reviewed-image loading, transfer
├── training/                   Training documents, parameters, recipes
├── detectors/
│   ├── contract.py             Algorithm-independent detector contract
│   ├── documents.py            Detection outcome decoding
│   ├── traditional/            Pipeline, result types, artifacts, training
│   └── ultralytics/            Detector, dataset preparation, training, runtime
├── worker/
│   ├── service.py              One process serving annotation, training and inference
│   ├── annotation.py           External-agent annotation transport
│   ├── inference.py            Inference protocol and task execution
│   ├── training.py             Training protocol and task execution
│   ├── model_store.py          Assigned models, cache, and loading
│   ├── session.py
│   ├── connection.py
│   ├── runtime.py
│   └── host/                   Profiles, logs, launchd, commands, host operations
└── io/                         Filesystem and image I/O
```

`autoannotation` depends only on shared contracts and filesystem/image I/O. Preparation freezes source pixels, configuration and candidate input. The protocol validates a complete response per tile; task operations handle checkpoints and recovery; collection restores source coordinates and exports reusable results. Geometry and rendering are shared utilities, and the CLI only adapts arguments. Each round preserves its input and output in separate directories. The module uses one current schema and has no model dispatcher or Worker dependency. See [the standalone annotation guide](autoannotation.md). `agent_annotation` composes it with `agent_runtimes` and owns execution and export recovery. The Worker invokes those operations without interpreting coordinator files or putting provider behavior in the annotation protocol. Product proposals remain distinct from accepted reviews; see [AI annotation](ai-annotation.md).

Worker execution can use algorithms and data documents. Algorithm families do not import workers or host operations. Dataset manifests depend on the detector contract, not an algorithm implementation; loading reviewed dataset entries belongs to `datasets/annotations.py`. Core annotation documents do not load datasets. The top-level package and detector namespace do not eagerly initialize algorithms.

`python scripts/check_architecture.py` checks package ownership, dependency directions, unresolved package imports, and file/package cycles, including type-only and function-local imports. It is part of `make check-python`.

## Execution identity

Traditional execution identity lives in `detectors/traditional/identity.py`. Its source fingerprint includes the pipeline's behavior dependencies, including image decoding in `io/image_io.py`. The detector runtime fingerprint also includes its adapter and common contract. Source paths are explicit and resolved relative to their owning implementation; moving a dependency does not justify dropping it from coverage.

A runtime fingerprint identifies execution code. A traditional artifact digest identifies the candidate model and configuration. The built-in model version ID is `traditional-v1`, and a trained one is the ID of the run that produced it. These identities have different purposes: a source change can change runtime identity without changing the artifact or inventing another model version. A regression test checks this distinction by varying image-decoder source bytes.

## Verification

`make check` runs Web builds, architecture checks, contract generation checks, formatting, type checks, and tests for both packages. The standard suite uses PGlite and in-memory blobs. PostgreSQL, S3, and private reference images have explicit integration targets in the Makefile. Package moves must preserve CLI entry points, bundled data resources, and executable runtime fingerprints as well as import resolution.

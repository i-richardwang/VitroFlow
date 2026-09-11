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

Image admission returns stable refusal codes. Training parameter constraints live in the Zod schema; the form derives bounds from that schema and owns only labels and interaction steps. The Python package validates parameters against generated JSON Schema instead of maintaining a second set of numeric ranges.

Domain exceptions inherit shared categories from `domain/errors.ts` and carry stable codes. The Server Function boundary converts expected refusals to an explicit `business_failure` document containing its code, category, and declared JSON details; it does not rely on preserving an Error subclass across serialization. The UI validates and translates that document. Diagnostic messages remain English, and unexpected exceptions are logged and passed to the framework's error handling. HTTP and MCP adapters retain their explicit protocol mappings.

## Calibration lifetime

`features/calibration/ImageWorkbench.tsx` owns one `Workbench` and one `ImageViewport`. Its `Viewing` and `Editing` children fill action, toolbar, and inspector slots and supply the visible box layer. The editing subtree is keyed by image and model so a different review loads its own baseline. Switching modes never keys or replaces the viewport. Display layers, manual zoom, and pan survive the switch.

`domain/annotation/draft.ts` owns the pure annotation draft, undo/redo, and the submission freeze. The calibration boundary loads the stored baseline before mounting an editor. A draft is initialized from that baseline (or detections for a first review), so its boxes and save base describe the same starting point. The editor owns save, navigation blocking, selection, and keyboard listeners. Unmounting editing ends that interaction lifetime without resetting the frame. The DOM lifecycle test performs wheel zoom and pointer panning, enters and leaves editing, and verifies both the original image node and its transform remain intact.

## Python source map

```text
src/vitroflow/
├── cli.py
├── contracts/                  Generated schemas, validation, decoding helpers
├── annotations.py              Annotation documents and geometry
├── datasets/                   Manifests, reviewed-image loading, transfer
├── training/                   Training documents, parameters, recipes
├── detectors/
│   ├── contract.py             Algorithm-independent detector contract
│   ├── documents.py            Detection outcome decoding
│   ├── traditional/            Pipeline, result types, artifacts, training
│   └── ultralytics/            Detector, dataset preparation, training, runtime
├── worker/
│   ├── service.py              One process serving both queues
│   ├── inference.py            Inference protocol and task execution
│   ├── training.py             Training protocol and task execution
│   ├── model_store.py          Assigned models, cache, and loading
│   ├── session.py
│   ├── connection.py
│   ├── runtime.py
│   └── host/                   Profiles, logs, launchd, commands, host operations
└── io/                         Filesystem and image I/O
```

Worker execution can use algorithms and data documents. Algorithm families do not import workers or host operations. Dataset manifests depend on the detector contract, not an algorithm implementation; loading reviewed dataset entries belongs to `datasets/annotations.py`. Core annotation documents do not load datasets. The top-level package and detector namespace do not eagerly initialize algorithms.

`python scripts/check_architecture.py` checks package ownership, dependency directions, unresolved package imports, and file/package cycles, including type-only and function-local imports. It is part of `make check-python`.

## Execution identity

Traditional execution identity lives in `detectors/traditional/identity.py`. Its source fingerprint includes the pipeline's behavior dependencies, including image decoding in `io/image_io.py`. The detector runtime fingerprint also includes its adapter and common contract. Source paths are explicit and resolved relative to their owning implementation; moving a dependency does not justify dropping it from coverage.

A runtime fingerprint identifies execution code. A traditional artifact digest identifies the candidate model and configuration. The built-in model version ID is `traditional-v1`, and a trained one is the ID of the run that produced it. These identities have different purposes: a source change can change runtime identity without changing the artifact or inventing another model version. A regression test checks this distinction by varying image-decoder source bytes.

## Verification

`make check` runs Web builds, architecture checks, contract generation checks, formatting, type checks, and tests for both packages. The standard suite uses PGlite and in-memory blobs. PostgreSQL, S3, and private reference images have explicit integration targets in the Makefile. Package moves must preserve CLI entry points, bundled data resources, and executable runtime fingerprints as well as import resolution.

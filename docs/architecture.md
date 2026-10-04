# Architecture

VitroFlow has a Web control plane and two Python packages: `vitroctl` (`src/vitroctl`) runs Workers, moves datasets and trains detectors for operators, and `vitroflow` (`packages/vitroflow`) prepares photographs for experimenters. Source boundaries describe the capabilities a module may use; each boundary is organized by the domain or lifecycle it owns. React components can render on the server, so a frontend directory does not authorize browser globals during rendering.

## Web boundaries

`domain/` and `lib/` do not import React, localization, frontend features, or server implementations, and do not access browser-only globals. Domain modules may use library utilities; libraries do not depend on domain modules. Domain schemas and transformations can be used directly by services, contract generation, or frontend features.

`features/` owns browser requests, form state, and interaction lifetimes. `ui/` may use domain types and display them, but never invokes a feature or Server Function. For example, the shell receives the signed-in account control as content; the account feature owns sign-out. File routes assemble these pieces. Both Server Functions and file-route HTTP handlers are valid service entry points.

The server module map and transaction rules are described in [Backend architecture](backend-architecture.md). Vite protects server files from client imports. `bun run architecture:check` additionally checks layer directions, pure-module capabilities, test isolation, all source-file cycles, and server public APIs. Imports, type imports, and re-exports participate in the rules. Dynamic imports must use literal paths.

## Shared rules and presentation

`domain/datasets/archive-format.ts` owns archive entry names and limits. `features/datasets/import-archive.ts` reads a browser archive, checks the destination, uploads its images, and applies the manifest. Services import the format without importing the browser workflow.

Image admission returns stable refusal codes. Training parameters, annotation configuration, and inference model manifests use authoritative Zod schemas. Forms derive bounds from those schemas and own only labels and interaction steps. Python validates against generated JSON Schema. Cross-field semantics remain with the domain that owns them.

Domain exceptions inherit shared categories from `domain/errors.ts` and carry stable codes. The Server Function boundary converts expected refusals to an explicit `business_failure` document containing its code, category, and declared JSON details; it does not rely on preserving an Error subclass across serialization. The UI validates and translates that document. Diagnostic messages remain English, and unexpected exceptions are logged and passed to the framework's error handling. HTTP and MCP adapters retain their explicit protocol mappings.

## Calibration lifetime

`features/calibration/ImageWorkbench.tsx` owns one `Workbench` and one `ImageViewport`. Calibration is session state on that frame: the same viewport stays mounted while the workbench loads the stored annotation, draws a draft, and returns to the stored review. Display layers, manual zoom, and pan survive the switch.

`domain/annotation/draft.ts` owns the pure annotation draft, undo/redo, and the submission freeze. The frame is idle until asked to calibrate, loading until the stored annotation matches this image and model, then a draft with shortcuts and leave-blocking. Draft instances begin from the displayed reading: review, AI proposal, or detections. The save base independently records the persisted review, so saving detects concurrent edits regardless of where the draft's boxes came from. Until the fetch completes, Save stays pending and the on-screen marks remain the current reading. A cancelled fetch or a different model must not inherit another review's baseline. The DOM lifecycle test performs wheel zoom and pointer panning, enters and leaves calibration, and verifies both the original image node and its transform remain intact.

## Python boundaries

`image_geometry` owns dish circle detection without model or annotation dependencies; traditional detection uses it, and the workbench reads the same [recipe](images.md) to bound AI annotation to the dish. AI annotation itself runs on the workbench and the agents people connect to it; see [AI annotation](ai-annotation.md).

`vitroflow` depends on neither `vitroctl` nor the workbench. It locates the dish with its own detector because it only needs a region to look in, not the reproducible analysis the workbench records for every stored image.

Worker execution can use algorithms and data documents. Algorithm families do not import workers or host operations. Dataset manifests depend on the detector contract, not an algorithm implementation; loading reviewed dataset entries belongs to `datasets/annotations.py`. Core annotation documents do not load datasets. The top-level package and detector namespace do not eagerly initialize algorithms.

`python scripts/check_architecture.py` checks package ownership, dependency directions, unresolved package imports, and file/package cycles, including type-only and function-local imports. It is part of `make check-python`.

## Execution identity

Traditional execution identity lives in `detectors/traditional/identity.py`. Its source fingerprint includes the pipeline's behavior dependencies, including image decoding in `io/image_io.py`. The detector runtime fingerprint also includes its adapter and common contract. Source paths are explicit and resolved relative to their owning implementation; moving a dependency does not justify dropping it from coverage.

A runtime fingerprint identifies execution code. A traditional artifact digest identifies the candidate model and configuration. The built-in model version ID is `traditional-v1`, and a trained one is the ID of the run that produced it. These identities have different purposes: a source change can change runtime identity without changing the artifact or inventing another model version. A regression test checks this distinction by varying image-decoder source bytes.

## Verification

`make check` runs Web builds, architecture checks, contract generation checks, formatting, type checks, and tests for the Web application and both Python packages. The standard suite uses PGlite and in-memory blobs. PostgreSQL, S3, and private reference images have explicit integration targets in the Makefile. Package moves must preserve CLI entry points, bundled data resources, and executable runtime fingerprints as well as import resolution.

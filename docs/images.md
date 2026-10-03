# Images

Every image is stored once, as a canonical AVIF under its digest. Ingestion also
finds the culture dish in it, so that work reading the image, such as
[AI annotation](ai-annotation.md), can be bounded to the dish.

## Dish analysis

Dish detection runs in one lazy compute thread per process using pinned OpenCV.js
4.12 WASM. Ingestion analyzes the final canonical AVIF bytes, including canonical
imports, and records completed analysis in `images.dish_analysis`. Only an RGB
thumbnail with longest edge at most 1200 pixels crosses the thread boundary.
Image encoding, digest and source coordinates remain unchanged. Canonicalization
and analysis are separate bounded operations; analysis reads the pixels of the
stored encoding.

Completed analysis stores its recipe identity and circle. A null circle means
successful analysis with no candidate; null analysis means unavailable. Repeated
uploads reuse current completed results.

One shared `image_geometry/dish-recipe.json` supplies Hough parameters and coverage
policy to both runtimes, validated against the generated `dish-recipe` contract.
The server uses Sharp Lanczos3 and OpenCV.js; native Python uses OpenCV INTER_AREA.
They share parameters and half-up thumbnail dimensions, but can produce slightly
different circles. Radius validation allows one thumbnail pixel of tolerance
around the integer Hough bounds.

The server's analysis identity contains detection parameters, preprocessing and
one explicit implementation revision. The shared JSON stores parameters without a
separate version number, so parameter changes alter the identity automatically.
Dependency version inventories and the coverage margin are excluded. Advance the
implementation revision for behavior changes not represented by detection
parameters, including relevant changes found when reviewing dependency upgrades.
Ordinary library upgrades alone do not invalidate the corpus.

## Maintenance

The maintenance process automatically refreshes unavailable or obsolete analysis.
It analyzes up to two images serially, then waits 30 seconds. Blob collection runs
on its own hourly cadence; infrastructure failures back off for one minute without
stopping the other responsibility. Maintenance uses one Sharp processing thread
and its own compute runtime, so its resource budget is separate from the
workbench's. Compose and the Zeabur template include this process as an
application service, using `bun dist/maintenance.js` and the shared database and
blob-store environment.

Deploy workbench and maintenance from the same source commit; image-based
deployments use the same image digest for both roles. Maintenance has no public
port or browser authentication settings. Existing Zeabur projects must add this
service explicitly: updating a template does not modify deployed projects.

`images.dish_analysis_attempted_at` durably records each analysis attempt.
Maintenance prioritizes never-attempted images, then the oldest eligible attempts,
with a 15-minute retry interval. Each claim commits in a short transaction using
[`FOR UPDATE SKIP LOCKED`](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE);
decoding holds no database locks. Result writes are fenced by the attempt
timestamp and cannot replace newer analysis. Missing or corrupt images fail
individually and do not block later images. Database and object-store transport
failures reach infrastructure backoff. Completed no-candidate results are not
retried. Shutdown finishes the current image before stopping.

From the built Web application, `bun run images:analyze [batch-size]` performs one
finite sweep of eligible images, using batches of 100 by default (maximum 1000).
A fixed attempt cutoff excludes every image tried during the sweep, even if a
long sweep outlasts its retry interval. Recent attempts remain in cooldown. The
command reports examined, completed, failed and skipped counts. Completed means
analysis was persisted; skipped means a newer result or image deletion made the
write unnecessary. Every attempt satisfies
`examined = completed + failed + skipped`. Image failures or interruption produce
a nonzero exit status; skipped results do not. It uses the same canonical pixels
and detector as ingestion.

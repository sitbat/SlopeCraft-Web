# Changelog

## Unreleased

Initial snapshot of the independent [SlopeCraft Web repository](https://github.com/sitbat/SlopeCraft-Web), based on SlopeCraft 5.4.1 at upstream commit `d4cda09853fe83141e155cb3a5280ce22ad9cd3a`. Repository history begins with this Web snapshot and does not include upstream Git history. Original copyright and GPL notices are retained. No release or version tag has been published.

- Included the Web application, its required C++ components, block resources and
  presets; excluded unrelated desktop application sources and native CI.
- Added a static browser UI for map configuration, image queues, conversion,
  terrain construction, materials, previews and exports.
- Ported the original C++ core to WebAssembly Memory64, SIMD and pthreads. Images and
  generated files are processed locally without a computation service.
- Added native map/NBT/Litematica/WorldEdit/diagram exports, map commands,
  assembled map frames, palette tools and block-list test structures.
- Included the original 336-block libraries and four presets; added custom ZIP
  imports and IndexedDB snapshots to release inactive native task memory.
- Added real 64-bit shared-memory addressing with a 16 GiB maximum and an
  engine-metadata budget range of 128–16384 MiB (default 1536 MiB). Node and a
  real browser exercised addresses above 4 GiB, preview copying and four-worker
  computation. This does not claim a 16 GiB real-data or device-memory stress
  test, or support in every browser; there is no wasm32 fallback.
- Added selection/restoration of conversion variants and independent side-by-side
  algorithm comparison, extending the desktop program's existing per-image
  algorithm cache. Variant native IDs preserve selected-result exports. Keep
  at most 24 LRU entries and 256 MiB of RGBA previews, with unreleased native
  estimates separately limited to half the applied budget. Cache clearing and
  engine reload invalidate the corresponding variants while retaining images.
- Added SVG/ICO favicons and a 180-pixel touch icon.
- Fixed water-column registration, auxiliary-material selection, genetic
  converter initialization, cache restoration and indexed PNG alpha decoding.
- Added a static HTTPS Service Worker isolation path, with a possible
  first-load reload and direct startup when server headers already isolate the
  page. The engine still requires confirmed isolation and uses pthreads only.
  Startup was checked in a Windows Chromium browser on loopback secure contexts with no
  server isolation headers, at both the origin root and a subdirectory.
- Added a precompressed pthread WASM transport: the current 1,915,266-byte core
  has a 644,629-byte gzip companion (66.3% smaller). Browser-native decoding
  handles ordinary gzip files and already-decoded responses, verifies raw size
  and SHA-256, and can fall back to the same verified multithreaded raw WASM.
  Core JS/WASM URLs use hash query parameters without requiring server encoding
  or rate-limit changes.
- Start core and catalog preparation together, then download the three bundled
  block ZIPs in parallel while preserving ordered native registration and reusing
  the catalog request. These changes do not claim measured browser-startup gains.
- Added independent NBT/PNG validation, actual pthread work counters, browser
  checks, reproducible Node benchmarks and a Web build/test workflow. The current
  suite passes 172 tests, including high-address Memory64 and conversion-history
  checks. The saved Node benchmark remains a historical wasm32 measurement, not
  a performance claim for this Memory64 build.

Known differences and verification limits are documented in
[`web/README.md`](web/README.md) and
[`web/tests/parity-checklist.md`](web/tests/parity-checklist.md).

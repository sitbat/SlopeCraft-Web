# Changelog

## Unreleased

Initial snapshot of the independent [SlopeCraft Web repository](https://github.com/sitbat/SlopeCraft-Web), based on SlopeCraft 5.4.1 at upstream commit `d4cda09853fe83141e155cb3a5280ce22ad9cd3a`. Repository history begins with this Web snapshot and does not include upstream Git history. Original copyright and GPL notices are retained. No release or version tag has been published.

- Included the Web application, its required C++ components, block resources and
  presets; excluded unrelated desktop application sources and native CI.
- Added a static browser UI for map configuration, image queues, conversion,
  terrain construction, materials, previews and exports.
- Ported the original C++ core to WebAssembly SIMD and pthreads. Images and
  generated files are processed locally without a computation service.
- Added native map/NBT/Litematica/WorldEdit/diagram exports, map commands,
  assembled map frames, palette tools and block-list test structures.
- Included the original 336-block libraries and four presets; added custom ZIP
  imports and IndexedDB snapshots to release inactive native task memory.
- Fixed water-column registration, auxiliary-material selection, genetic
  converter initialization, cache restoration and indexed PNG alpha decoding.
- Added a static HTTPS Service Worker isolation path, with a possible
  first-load reload and direct startup when server headers already isolate the
  page. The engine still requires confirmed isolation and uses pthreads only.
  Startup was checked in a Windows Chromium browser on loopback secure contexts with no
  server isolation headers, at both the origin root and a subdirectory.
- Added independent NBT/PNG validation, actual pthread work counters, browser
  checks, reproducible Node benchmarks and a Web build/test workflow.

Known differences and verification limits are documented in
[`web/README.md`](web/README.md) and
[`web/tests/parity-checklist.md`](web/tests/parity-checklist.md).

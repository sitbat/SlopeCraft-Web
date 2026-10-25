# SlopeCraft Web verification checklist

This checklist uses the original `SlopeCraft/SCWind.ui`, `SCWind.h`,
`SCWind.cpp`, `SCWind_slots.cpp`, `SlopeCraftL/SlopeCraftL.h`,
`utilities/SC_GlobalEnums.h` and export implementations as its baseline.

The Node engine suite loads the actual compiled pthread Wasm. It never replaces
the engine with a JavaScript approximation. The small NBT/PNG fixture tests
validate the independent inspection tools and are reported separately.

## Run

From `web/`, with Node available:

```sh
node --test tests/assets.test.mjs tests/nbt.test.mjs tests/png.test.mjs
node --test tests/engine.test.mjs
node --test tests/static-bootstrap.test.mjs tests/static-worker.test.mjs
```

Prepare the assets before the first command and build `web/wasm/slopecraft.js` before the second command.
Set `SC_WASM_MODULE` only when checking an alternate compiled artifact. A missing
artifact fails the engine suite explicitly; it is not counted as a pass or skip.

## Automated engine coverage

| Original behavior | Check |
| --- | --- |
| C++ core in browser-compatible shared memory | Factory's heap must be a `SharedArrayBuffer`; metadata must advertise pthreads and four configured workers. |
| Actual multithread color matching | A 256 × 256 image must produce at least two nonzero per-thread completion counters, with at least 1000 work items completed. A pool's existence alone is insufficient. |
| Original fixed/custom/Quark block libraries | Real ZIPs are parsed by the C++ blocklist reader; block IDs, versions and base colors are checked. Asset checks compare every original PNG, block list and optional `metainfo.json` byte-for-byte. |
| Native block icons | Independently decode original RGBA glass and indexed+tRNS iron-trapdoor PNGs, and compare every RGBA byte with `blockIcon`; a second material must retain different pixels. |
| Current palette tool | It works without an image even with GA selected; eighteen version/type combinations check filtering and convert every exact palette RGB back to an allowed map ID. |
| Test-blocklist tool | Without converting any image, export selected valid blocks as NBT and litematic and compare every occupied block coordinate, including original marker geometry. |
| RGB, RGB+, HSV, XYZ, Lab94, Lab00, GA | All seven core algorithms run. The original main window displays six; HSV is additionally available in the core. GA uses small valid parameters. |
| RGBA channel order and image orientation | A non-square 5 × 3 image has fifteen distinct exact map palette colors. Every preview pixel and exported map ID must remain at its original source coordinate. |
| Dithered conversion | Non-GA conversion must repeat exactly with dithering both on and off. |
| All twelve game-version choices | 1.12 through 1.21, 26.1.2 and 26.2 each export a parsed, valid map data file. |
| Version-dependent map filenames | Before 26.1: `map_<index>.dat`; 26.1 onward: `<index>.dat`. |
| Map splitting and numbering | A 129 × 130 image produces four column-major numbered maps, preserves every preview coordinate, and writes transparent zero padding outside the image. |
| Slope and flat construction | Both modes build real structures with expected horizontal bounds and positive occupied-block counts. |
| Litematica, vanilla NBT and WorldEdit | Independently decode each file; compare actual block names, properties, dimensions and coordinates, independent of palette order or gzip bytes. |
| Litematica metadata | Unicode schematic and region names round trip, and metadata volume/counts agree with decoded data. |
| WorldEdit versions and offsets | 1.19 uses Sponge v2 with required mods and WE offsets; 1.21 uses v3 and normal offset. The upstream 1.12 unsupported-format error is expected. |
| Air versus structure void | The omission checkbox changes serialized air positions while preserving every occupied block. |
| Flat construction diagram | Validate PNG signature, chunk CRCs, decompression, dimensions, and scanline filters of the real texture-based output. |
| Full transparency | Preserve-as-air exports map ID zero; background replacement produces a colored pixel. |
| Half transparency | Replace, composite and retain-RGB behaviors match independently calculated opaque control images. |
| Height, bridge, protection and support options | Exercise all four compression modes and all three support choices, with glass bridges, fire/Enderman protection and mushroom connectivity enabled; decoded volume and total material quantities must agree. This matrix is a compatibility smoke check, not a proof that each option changed this fixture's geometry. |
| Real height reduction | An exact bright-stone column needs twenty layers without compression; forced compression must reduce it to at most fourteen layers, change the preview shades, and preserve cross-format block equality. Lossless compression must preserve every preview pixel. |
| Disabled color versus required construction material | Disable glass and stone as map colors, then build water enclosures, bridges and stone support; actual glass/stone identities must remain valid across all terrain export formats. |
| Water shades and boundary row | Each exact water shade is tested in a one-pixel image: physical water depths must be 11, 6 and 1 blocks, with glass enclosures. This also catches loss of the first image row. |
| Assembled map wall/floor/ceiling | All twelve original facing/rotation combinations export two entities in both NBT and litematic; check facing, rotation, map IDs, glow, fixed and invisible flags. |
| Give commands | Check pre-1.13, pre-1.20.5 and modern item-component command forms and map IDs. |
| Native converted-image and 3D caches | Save real cache bytes, release the native image/structure, remove and rewrite MEMFS cache files, restore them, and compare dithered alpha previews, map pixels and all three terrain export formats. Also check releasing only the 3D structure retains map data. |
| Recoverable errors | Unknown operations, unknown task IDs, bad RGBA lengths, malformed block ZIPs and empty palettes must report errors, followed by a successful conversion/export. |

## Browser checks required separately

These cannot be established by the direct C++/Wasm API suite:

- Main window grouping, compact desktop layout, tabs, image lists, thumbnails,
  progress, zoom and material preview against the original UI.
- Add/remove/replace images, current/all conversion, selection and batch export.
- Four presets (`vanilla`, `cheap`, `elegant`, `shiny`), custom presets, per-base
  block choice, material preferences, select all/none/invert, and imported ZIPs.
- PNG/JPEG image decoding and converted-image downloads from the browser canvas.
- GA configuration dialog, background color/transparency controls, export options
  and version-dependent availability actually reach the engine.
- Browser cache persistence/clearing, memory settings, project save/reload,
  language choice and original help/about/license links.
- Worker initialization and errors in the browser's actual isolation context;
  UI responsiveness while C++ pthreads calculate; download bytes round trip.
- Already-isolated hosting starts the pthread engine directly without a needless
  Service Worker registration or reload.
- A plain HTTPS static site can register the same-directory isolation Worker,
  become controlled, reload at most once for that bootstrap attempt and only
  report ready after `crossOriginIsolated` and SharedArrayBuffer are available.
- The static package retains `coi-serviceworker.js`, `static-bootstrap.js` and
  `browser-environment.js`, served with JavaScript MIME types. Verify registration
  at an origin root and in a subdirectory with a separate same-origin scope.
- Denied Service Worker/sessionStorage, unsupported `file://` access, missing or
  incorrectly typed scripts, and competing Worker control must produce an honest
  startup state without reload loops, taking over another application's Worker,
  or falling back to a single-thread engine.
- Narrow-window/mobile rendering and supported browser versions.

The Service Worker navigation and isolation lifecycle needs browser verification;
the direct Node engine suite does not establish it. Keep actual results separate
from this checklist. No cloud deployment or physical-device result is implied.
Production network/certificate/access-control configuration remains the deployer's
responsibility. Server COOP/COEP headers remain an alternative to the static
bootstrap. All runtime tests use the pthread build, with no single-thread fallback.

## Limits of the evidence

Cross-format equality establishes consistent exported block identities and
coordinates. It does not prove native desktop output is byte-for-byte identical,
Minecraft has loaded each exported file, all large inputs fit browser memory,
or all geometry option combinations are correct. A separate native-oracle
comparison and game import remain useful for those claims. The original desktop
conversion path replaced the GA choice with RGB+; the Web path executes the
upstream GA implementation, so GA should not be used as an identical-output
native oracle.

## Reproducible Node benchmark

```sh
node tests/benchmark.mjs
node tests/benchmark.mjs --dither --threads=4 --runs=3
```

The report is written to `web/test-results/benchmark-node.json` and records the
exact compiled artifact hash. It measures 256, 512 and 1024 square conversions
with RGB+ and CIEDE2000, plus 512-square slope construction with lossless height
compression/glass bridges and all three terrain formats plus map data export.
The input uses a fixed xorshift32 seed and near-24-bit random opaque pixels;
the report includes unique-color counts so repeated-color cache effects are
visible. Every case clears native tasks. Timings exclude input generation and
include ABI/preview copying; Wasm memory is linear-memory capacity. These are
Node measurements, and must not be described as browser timings.

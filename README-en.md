# SlopeCraft Web

[中文](README.md) | **English**

[Source repository](https://github.com/sitbat/SlopeCraftWeb)

A static browser application for creating Minecraft map art. Based on [SlopeCraft](https://github.com/SlopeCraft/SlopeCraft) 5.4.1, it retains the original C++ conversion, structure-building and export algorithms, compiled to WebAssembly with SIMD and pthreads.

Only static file hosting is needed in production. Images and computation stay in the browser; no computation backend, account or database server is required. This is an independent repository created from the initial Web source snapshot. Its Git history starts with that snapshot and does not inherit upstream commits. It contains the Web application and its required C++ components and resources. The original application was written by **TokiNoBug and the SlopeCraft contributors**; their copyright and GPL notices are preserved. Desktop documentation is kept in the [upstream archive](docs/upstream/README.en.md), and the source baseline is recorded in [UPSTREAM.md](UPSTREAM.md).

![SlopeCraft Web map-art workbench](docs/images/preview.jpg)

## Features

- **Configuration:** slope, flat and map-file modes; Java 1.12–1.21, 26.1.2 and 26.2; original and additional block libraries, four upstream presets, per-base-color block choices, custom ZIP block packs, and preset import/export.
- **Images and conversion:** batch import, drag and drop, paste, crop, resize and alpha handling; RGB, RGB+, HSV, XYZ, Lab94, Lab00, genetic conversion and dithering; original, converted and comparison previews.
- **Construction and materials:** lossless/lossy height compression, height limits, bridges, support blocks, fire/Enderman protection and mushroom connections; compressed-image previews and material lists with CSV export.
- **Exports:** Litematica, vanilla structure NBT, WorldEdit schematics, flat construction diagrams, map data, give commands and assembled item-frame maps. Multiple exported files are bundled into ZIPs.
- **Tools and caching:** actual current-palette PNG/CSV and blocklist test structures; IndexedDB computation snapshots, cache statistics/clearing, memory budgets and locally saved settings.

Changing an image or relevant settings invalidates old results; export automatically recomputes them. Computation caching reduces memory use for the current image pool. **Reloading the page does not restore that pool.** Export what you need and keep the original images separately.

## Run locally

Use **Node.js 22 or newer**. The browser files and precompiled engine live in `web/`, so preview does not require an SDK or recompilation. `prepreview` prepares the assets automatically. The local preview script binds only to loopback and supplies the isolation headers needed for development.

```sh
# Run from the repository root. These scripts have no npm dependencies to install.
npm run preview
```

Open the printed address, normally `http://127.0.0.1:4173`. This is a development and verification tool. Production networking, certificates, redirects and server configuration remain the deployer's responsibility.

## Static deployment

Preview from the source checkout, or generate static files with the source-build steps below. Host **all of `web/dist/`** together as static files. The packaging script also creates `SlopeCraft-Web-static.zip` in the repository's parent directory. Root and subdirectory hosting are supported; runtime resources use relative URLs and do not depend on a CDN. Node, Python, Qt and Emscripten are not needed to run the deployed application.

The browser must provide:

- An **HTTPS secure context** in production; localhost/loopback is suitable for local development.
- WebAssembly SIMD, Web Workers and SharedArrayBuffer.
- Cross-origin isolation: `crossOriginIsolated === true`. A typical setup supplies `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` response headers.

**Only the multithreaded engine is provided; there is no single-thread fallback.** HTTPS alone does not establish cross-origin isolation. Opening the HTML directly from the filesystem is insufficient. The settings dialog reports the actual environment and missing requirements. This repository does not automatically configure production hosting.

## Build the engine from source

Preview supports Node.js 22+; development and CI use Node.js 24. Building the engine also requires CMake 3.29+, Ninja, and an installed and activated **Emscripten 4.0.23** SDK. Set `EMSDK` to its root; optionally set `CMAKE` and `NINJA` to executable paths.

```sh
npm run build:wasm
npm run assets
npm test
node web/scripts/package-dependencies.mjs
npm run build
node web/scripts/check-static.mjs
```

The Web build entry point is [`web/CMakeLists.txt`](web/CMakeLists.txt). Dependency versions and archive hashes are pinned in [`web/dependency-lock.json`](web/dependency-lock.json); downloads happen at build time. The Web build does not require Qt or native OpenMP.

The default build directory is `build/web`. Set `SC_BUILD_DIR` to change it and `SC_BUILD_JOBS` to control parallel compilation. `package-dependencies.mjs` collects corresponding dependency sources and licenses from that same build directory before `npm run build` packages them. Generated dependency sources and `web/dist/` are excluded from Git.

The package includes the modified project source, corresponding dependency sources and licenses. See [`web/README.md`](web/README.md) for detailed usage/build notes and [`web/THIRD_PARTY_NOTICES.md`](web/THIRD_PARTY_NOTICES.md) for third-party components.

## Verification and differences

```sh
npm test
node web/scripts/check-static.mjs
# Optional Node WASM benchmark
node web/tests/benchmark.mjs
```

Build the static package before running its integrity check. Tests load the real pthread WASM; they do not substitute a JavaScript approximation. The saved verification records **113 passing tests**, covering algorithms, per-thread work counters, map splitting, structure semantics, transparency, block icons and native caches. See the [coverage checklist](web/tests/parity-checklist.md) and [verification record](web/test-results/verification.json).

Browser checks on Windows Chromium cover import, conversion, construction, materials, downloads, caching and layouts at widths of 390, 633 and 1280 pixels. Responsive viewport checks are not physical-phone tests, and Node benchmarks are not browser performance measurements. Exports are independently parsed; each format has not yet been imported and verified inside Minecraft.

- The port covers the **SlopeCraft main application**. VisualCraft, the separate MapViewer and the standalone imageCutter are not ported, and their desktop application sources are not included in this repository. The Web interface includes crop and resize tools.
- Browser pickers, downloads and storage replace arbitrary local-path access. The interface currently uses Chinese. Desktop auto-updating and operating-system memory inspection are absent.
- The original dense 3D representation is retained. The default calculation budget is 1536 MiB, adjustable from 128 to 3072 MiB. It is a preflight threshold, not a guarantee that the browser can allocate that memory. Resize or split oversized inputs.
- “Stop subsequent tasks” stops the queue after the current C++ call finishes; it does not forcibly interrupt that calculation.
- WorldEdit export does not support Java 1.12. Flat construction diagrams require flat map-art mode.

## Source layout

| Path | Contents |
| --- | --- |
| `web/` | Browser interface, Worker, cache, Web build and packaging scripts |
| `web/native/` | C++ ABI, pthread dispatch and browser adaptations |
| `web/tests/` | Real-engine tests, independent NBT/PNG inspection and coverage checklist |
| `SlopeCraftL/`, `utilities/` | Retained and adapted C++ algorithms and export libraries |
| `Blocks_SCL/` | Upstream block lists, textures and additional libraries |
| `SlopeCraft/others/presets/` | The four upstream presets used by the Web application |
| `docs/upstream/` | Archived Chinese and English desktop READMEs |

The port is based on upstream commit [`d4cda09853fe83141e155cb3a5280ce22ad9cd3a`](https://github.com/SlopeCraft/SlopeCraft/commit/d4cda09853fe83141e155cb3a5280ce22ad9cd3a). Map-art principles and upstream tutorials are available in the [SlopeCraft documentation](https://slopecraft.readthedocs.io/).

## Contributing and feedback

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes. Report security issues as described in [SECURITY.md](SECURITY.md). The Web build pipeline is defined in the [GitHub Actions workflow](.github/workflows/web.yml).

## License and attribution

This project retains **GPL-3.0-or-later**; see [LICENSE](LICENSE). Copyright and author notices for TokiNoBug and the original contributors are preserved. This repository's Web interface, adaptations and fixes do not imply an official upstream release. Dependencies retain their own licenses; see [`web/THIRD_PARTY_NOTICES.md`](web/THIRD_PARTY_NOTICES.md) for notices and corresponding-source information.

# Contributing to SlopeCraft Web

This independent repository contains a Web port of [SlopeCraft](https://github.com/SlopeCraft/SlopeCraft). Its Git history starts with the initial Web snapshot rather than inheriting upstream commits. The exact upstream baseline and retained attribution are recorded in [UPSTREAM.md](UPSTREAM.md).
The original SlopeCraft authors retain their existing copyright notices and
credit. Contributions to this port use the project's GPL-3.0-or-later license;
preserve applicable source headers and third-party notices.

## Scope

The product consists of `web/`, the C++ components it builds from `SlopeCraftL/`
and `utilities/`, block resources and the presets needed by the Web application.
Preserve documented algorithm behavior when changing retained components. Use
the existing `SLOPECRAFT_WEB` boundary for browser-specific code where needed.
VisualCraft, MapViewer, imageCutter and the desktop GUI sources are not included
in this repository.

Describe a concrete problem and its resulting behavior in a pull request. Include
the smallest useful reproduction and relevant validation. UI changes should
include desktop and narrow-window screenshots. For upstream algorithm fixes,
describe any intended difference from the original output.

## Build and test the Web port

Use Node.js 24, CMake 3.29 or newer, Ninja, and an activated Emscripten 4.0.23 SDK.
No npm dependency installation is required. The SDK installation steps are in
the [official Emscripten guide](https://emscripten.org/docs/getting_started/downloads.html).

From the repository root on a POSIX shell:

```sh
# Set EMSDK to the absolute SDK directory you installed.
project_node="$(command -v node)"
source "$EMSDK/emsdk_env.sh"
export SC_BUILD_DIR=build/web
"$project_node" web/scripts/build-wasm.mjs
"$project_node" web/scripts/prepare-assets.mjs
"$project_node" --test web/tests/*.test.mjs
"$project_node" web/scripts/package-dependencies.mjs
mkdir -p web/test-results
"$project_node" web/scripts/build-static.mjs
"$project_node" web/scripts/check-static.mjs
```

Capturing the Node executable before activating the SDK keeps the project's
Node version separate from the SDK's bundled Node. On Windows, activate the
SDK with its Windows instructions, then run the same Node scripts from the
repository root. `CMAKE`, `NINJA`, `SC_BUILD_DIR` and `SC_BUILD_JOBS` can override
the build tool locations, build directory and compile parallelism.

`web/dependency-lock.json` pins download hashes consumed by the Web CMake build.
For a dependency update, review its source/license changes, update the pinned
version and hash together, rebuild, and regenerate the matching dependency source
bundle. Do not silently disable checksum verification to make a download pass.

## Validation

The tests load the real pthread Wasm artifact. A missing compiled core fails the
engine tests. Independent decoders check NBT, litematic, schematic and PNG output;
see [the coverage checklist](web/tests/parity-checklist.md) for their scope.
For core changes, add a small regression that exercises the affected behavior,
and rerun the full engine suite after rebuilding. Do not replace exported-file
checks with tests that merely repeat implementation details.

Browser checks remain necessary for input decoding, worker startup, UI behavior,
downloads and IndexedDB. `node web/scripts/preview.mjs` starts the optional local
development preview. Production hosting configuration belongs to the deployer.
The port ships a pthread/SIMD build; do not introduce a single-thread fallback.

Validate both browser startup paths separately: an already-isolated page starts
directly, while a plain HTTPS static origin may use the same-directory Service
Worker to add COOP/COEP and reload once before isolation is confirmed. Keep
`coi-serviceworker.js`, `static-bootstrap.js` and `browser-environment.js` in
the packaged application directory, with JavaScript MIME types. Require permitted
Service Workers and `sessionStorage`, a separate same-origin scope with no
competing Worker, and no takeover of other applications' Workers. `file://`
is unsupported. Registration or isolation failures must report the actual state
without starting an unisolated engine or adding a single-thread fallback.
Server-provided headers remain a valid alternative. Document real browser results;
Node tests alone do not verify this navigation/reload lifecycle or a cloud setup.

Use `node web/tests/benchmark.mjs` for a reproducible Node measurement. Identify
the runtime, hardware, fixture and compiled artifact when reporting performance.
Node results do not establish browser or mobile performance.

## CI and release artifacts

[The Web workflow](.github/workflows/web.yml) builds on Ubuntu with Node 24 and
the official pinned Emscripten SDK, runs tests, packages matching dependency
sources/licenses, and verifies the static deployment archive. Its Actions
artifact is a build result, not an automatic release or deployment. Check the
actual workflow run before saying CI passed.

Before distributing a modified binary, include the corresponding modified
project source, build scripts, dependency lock, applicable dependency sources and
licenses using the packaging scripts. Generated build trees, SDK installations
and local credentials do not belong in commits.

For suspected vulnerabilities, follow [SECURITY.md](SECURITY.md).

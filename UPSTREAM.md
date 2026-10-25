# Upstream and attribution

[SlopeCraft Web](https://github.com/sitbat/SlopeCraft-Web) is an independent Web
repository derived from [SlopeCraft](https://github.com/SlopeCraft/SlopeCraft),
created by TokiNoBug and the SlopeCraft contributors. The retained source keeps
its original copyright headers and GPL-3.0-or-later license.

This repository starts from an initial Web source snapshot. Its Git history
begins with that snapshot; upstream commits and desktop application history are
not imported. Source attribution and the upstream reference below identify the
origin of the reused code independently of this repository's history.

- Upstream source revision: [`d4cda09853fe83141e155cb3a5280ce22ad9cd3a`](https://github.com/SlopeCraft/SlopeCraft/commit/d4cda09853fe83141e155cb3a5280ce22ad9cd3a).
- Original desktop version: 5.4.1.
- Web repository: [sitbat/SlopeCraft-Web](https://github.com/sitbat/SlopeCraft-Web).
- Archived original desktop documentation: [Chinese](docs/upstream/README.zh-CN.md)
  and [English](docs/upstream/README.en.md).

## Included source

The snapshot contains the Web application, the C++ components it builds from
`SlopeCraftL/` and `utilities/`, block resources in `Blocks_SCL/`, the four presets
in `SlopeCraft/others/presets/`, documentation and applicable license notices.
VisualCraft, MapViewer, imageCutter and the desktop GUI application sources are
not included. The archived desktop documentation describes the upstream project,
not additional programs shipped by this repository.

The port reuses upstream conversion, compression, terrain construction and
NBT/schematic algorithms. Web-specific code lives in `web/`; adaptations in
`SlopeCraftL/` and `utilities/` remove Qt diagnostics from the browser build,
use pthreads, adapt wasm32 index types, expose the JavaScript boundary and repair
issues covered by conversion, texture, water and cache regression tests.

This is an independent Web port. It does not claim that the original SlopeCraft
maintainers maintain or endorse this repository.

## Dependencies and distribution

Dependency versions and archive hashes are recorded in
[`web/dependency-lock.json`](web/dependency-lock.json). Original dependency
licenses are retained in [`web/assets/licenses/`](web/assets/licenses/).
The complete static packaging process collects corresponding dependency sources
and licenses before producing its distribution and modified-source archives.
The current project has no published release or version tag.

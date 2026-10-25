# Third-party components

SlopeCraft and this Web port retain the original GPL-3.0-or-later notices.
Original project: https://github.com/SlopeCraft/SlopeCraft
Upstream revision: d4cda09853fe83141e155cb3a5280ce22ad9cd3a.

Full original license texts are in `assets/licenses/`; source-archive SHA-256
hashes are in `dependency-lock.json`. The corresponding source package includes
the original dependency archives and the Boost source/header subset actually
read by the compiler.

| Component | Version | License family |
| --- | --- | --- |
| Eigen | 5.0.1 | MPL-2.0; see COPYING files for individual components |
| HeuristicFlow | 1.6.5.2 | GPL-3.0 |
| xsimd | 13.2.0 | BSD-3-Clause |
| cereal | 1.3.2 | BSD-3-Clause |
| nlohmann/json | 3.11.3 | MIT |
| magic_enum | 0.9.7 | MIT |
| Boost | 1.86.0 | Boost Software License 1.0 |
| zlib | 1.3.1 | zlib license |
| libpng | 1.6.50 | libpng license |
| Zstandard | 1.5.7 | BSD license; original alternative also retained |
| libzip | 1.11.4 | BSD license |
| PrismLauncher/libnbtplusplus | 23b955121b8217c1c348a9ed2483167a6f3ff4ad | LGPL-3.0 |

Emscripten 4.0.23 supplies generated JavaScript runtime, LLVM/libc++ and standard
library support. See https://emscripten.org/docs/introducing_emscripten/emscripten_license.html
and the SDK's original license files. There is no runtime CDN dependency.

Minecraft block data, textures and presets are retained from the original
SlopeCraft repository, with their original names and attribution.

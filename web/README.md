# SlopeCraft Web

[SlopeCraft Web](https://github.com/sitbat/SlopeCraft-Web) 是独立的纯静态网页移植仓库，基于 SlopeCraft 5.4.1（上游提交 `d4cda09853fe83141e155cb3a5280ce22ad9cd3a`）。
本仓库 Git 历史从 Web 初始源码快照开始，不继承上游提交历史；只保留 Web 所需的 C++ 组件、方块资源和预设。
原作者版权与 GPL 声明保留，来源说明见 [UPSTREAM.md](../UPSTREAM.md)。
图片、方块包、转换、三维构建、缓存与导出均在浏览器本地处理，不需要计算后端、账号或数据库服务器。
核心保留原 C++23 算法，以 Emscripten 编译为 WebAssembly Memory64，开启 SIMD 与 pthreads。
网页界面参照原程序的三个工作步骤实现，只提供多线程构建。

## 使用构建产物

将 `web/dist/` 的全部内容作为同一站点的静态文件托管。旁边的 `SlopeCraft-Web-static.zip` 是同一目录的部署压缩包。
支持站点根目录或子目录，运行时资源均使用相对 URL，不依赖 CDN。
运行不需要 Node、Python、Qt 或 Emscripten。

浏览器运行条件为 HTTPS 安全上下文、WebAssembly Memory64、共享的 64 位线性内存、SIMD、Web Worker、SharedArrayBuffer 和跨源隔离；本地开发可使用 localhost／回环地址。引擎只在 `crossOriginIsolated === true` 且共享内存检查通过后启动。

- 服务器已配置 COOP/COEP 并完成隔离：直接启动。
- HTTPS 静态站点尚未隔离：尝试注册同目录 Service Worker，为受控页面与资源响应补充 COOP/COEP；首次可能自动刷新一次，等待接管并确认隔离成功后才启动。

必须保留同一应用目录内的 `coi-serviceworker.js`、`static-bootstrap.js`、`browser-environment.js`，并以 JavaScript MIME 类型提供；采用 Service Worker 流程时，浏览器需允许 Service Worker 与 `sessionStorage`。将应用放在独立的同源目录，不让其他 Service Worker 接管，启动流程也不应替换其他应用的 Worker。不能使用 `file://`。

支持并允许该流程的 HTTPS 浏览器可通过静态文件补齐隔离响应头，无需单独修改云服务器的隔离配置；服务器直接配置 `Cross-Origin-Opener-Policy: same-origin`、`Cross-Origin-Embedder-Policy: require-corp` 仍可替代此流程。网络、证书、跳转、访问控制和生产服务器配置仍由部署者负责。
仅提供 Memory64 多线程引擎，无 wasm32 或单线程回退。页面显示实际的注册、隔离和引擎状态，失败时明确提示。

## 核心下载与启动

`web/scripts/prepare-wasm.mjs` 生成 `wasm/slopecraft.wasm.gz` 和 `wasm/wasm-integrity.js`，资源准备脚本会调用它。当前原始核心 1,915,266 字节，gzip 644,629 字节，文件大小减少 66.3%；这不代表已测得相同比例的浏览器提速。

`wasm-loader.js` 直接请求普通静态 gzip 文件，用原生 `DecompressionStream` 解压，再校验原始 WASM 的大小与 SHA-256。服务器若已通过 `Content-Encoding` 解压，加载器按实际字节判断并跳过重复解压。缺解压支持、gzip 无效或校验失败时，回退到同一多线程原始 WASM 并再次校验，不提供单线程引擎。

`startup-resources.js` 从界面准备阶段就并行启动核心与方块目录加载，目录返回后同时下载三个内置 ZIP；原生注册仍按目录顺序进行。目录加载结果复用，不重复请求。核心 JS 与 WASM URL 带对应 SHA 查询参数，更新时须保持元数据、JS、原始 WASM 和 gzip 属于同一构建。

保留部署目录中的 `wasm-loader.js`、`startup-resources.js` 和完整 `wasm/`（含 gzip 与元数据 JS），按正确 MIME 提供 JavaScript 文件。压缩加载不要求修改服务器 `Content-Encoding` 或限速配置，HTTPS、跨源隔离和多线程条件仍适用。具体浏览器耗时需另行测量。

## 功能

1. 配置：十二个 Java 版本（1.12–1.21、26.1.2、26.2），立体／平面／纯文件地图画；原版、自定义和 Quark 三个内置方块库（336 个方块），四套原版预设，自定义预设导入导出，逐基色选择与批量材质偏好；当前颜色表查看／PNG／CSV，以及方块列表测试结构导出。
2. 图像：多文件导入、拖放、粘贴、项目池、多选、替换／删除、裁切缩放与恢复原图；RGB、RGB+、HSV、XYZ、Lab94、Lab00、遗传算法及参数；抖动、透明像素策略；原图／转化／对照预览、算法结果选择与并排对比、缩放、地图网格与 PNG 下载。
3. 构建：无损／有损压缩、高度上限、玻璃搭桥与间隔、防火、防末影人、蘑菇连接、辅助支撑块；材料用量、组数和 CSV 导出、压缩后图像预览。
4. 导出：Litematica、原版结构 NBT、WorldEdit Sponge schematic、带真实方块纹理的平面施工图、地图数据文件及编号、原生地图命令、十二种朝向／旋转的展示框装裱地图（NBT／Litematica）；名称、区域、偏移、所需模组、空气处理、物品组件版本、发光／固定／隐形展示框等选项。
5. 批量：当前／全部转换、选中／全部导出、地图编号连续分配，多文件 ZIP 打包，停止后续任务。
6. 缓存与设置：IndexedDB 保存原核心 cereal／zstd 快照，保存成功后释放 C++ 图片和三维矩阵，下次构建／导出自动恢复；查看及清理本次任务的缓存。设置自动保存在本地，可导入导出。

原桌面程序已有图像／算法结果缓存；Web 新增历史选择和独立并排预览。结果键包含原图 revision、版本、地图类型、算法、抖动、透明处理、全部遗传参数、方块选择及启用库。切回相同配置可命中原结果，其原生变体 ID 也用于构建和导出；原图变化、对应缓存清理或引擎重载后按需重算。

对比缓存采用 LRU，最多 24 项，RGBA 预览独立限制为 256 MiB；自动快照成功后原生结果释放，不计入驻留估算。仍驻留的原生结果按图片／结构估算，另限为已应用计算预算的一半。超限清理旧结果，单个超大结果只留最新项；清理不会删除原图。980 × 858 图像的七算法 × 两种抖动共 14 组合已验证全部保留，预览合计 47,087,040 字节。

计算缓存用于降低当前项目池内存占用；刷新页面不恢复图像项目池，原图应另行保留。
停止按钮在当前 C++ 调用完成后停止后续项目，不强制中断正在计算的结构。

## 桌面版差异

- 文件选择、下载和浏览器存储替代任意本地路径访问与打开文件夹；没有桌面自动更新、操作系统内存探测。
- 覆盖 SlopeCraft 主程序的 Web 功能。VisualCraft、独立 MapViewer 和独立 imageCutter 没有一并移植，其桌面程序源码不包含在本仓库；网页内提供图片裁切和缩放。
- 保留原稠密三维矩阵。当前 Memory64 共享线性内存上限 16 GiB，默认预算 1536 MiB，可调整到 128–16384 MiB；界面范围由实际引擎元数据提供。预算仅是单次任务估算预检查阈值，不是总堆硬上限或物理内存承诺；JavaScript 原图和预览另占内存。大图仍可能需要缩小或拆分，手机与桌面性能不能等同。
- 浏览器决定可解码的图像格式；网页主要界面为中文。
- WorldEdit 不支持 Java 1.12，与上游相同。平面施工图仅用于平面地图画。

## 构建和验证

预览需要 Node 22+；开发、测试与 CI 使用 Node 24。引擎构建还需要 CMake 3.29+、Ninja，以及安装并激活的 Emscripten 4.0.23。
依赖版本和下载哈希固定在 `CMakeLists.txt` 与 `dependency-lock.json`，仅构建时下载。

```sh
# 激活自己的 Emscripten SDK，使 EMSDK 指向 SDK 根目录。
# CMAKE、NINJA 可按需指定可执行文件路径。
node web/scripts/build-wasm.mjs
node web/scripts/prepare-assets.mjs
node --test web/tests/*.test.mjs
node web/scripts/package-dependencies.mjs
node web/scripts/build-static.mjs
node web/scripts/check-static.mjs
```

默认构建目录 `build/web64` 可用 `SC_BUILD_DIR` 更改，`SC_BUILD_JOBS` 控制编译并行度。
`node web/scripts/package-dependencies.mjs` 从同一构建目录收集对应依赖源码和许可证，再由静态打包脚本生成包含这些文件的源码包。当前没有已发布的 Release 或版本标签。
本机验收使用 `node web/scripts/preview.mjs`，只监听回环地址。它是开发工具，不是生产服务器配置。

完整套件通过 172 项，包括实际引擎、独立格式解析、Memory64 和多结果缓存测试，检查范围及证据限制见 [tests/parity-checklist.md](tests/parity-checklist.md)。
基准用 `node web/tests/benchmark.mjs` 重现；[test-results/benchmark-node.json](test-results/benchmark-node.json) 记录旧 wasm32 构建及其哈希，是历史 Node 测量，不能当作当前 Memory64、浏览器或手机性能证据。
浏览器另行验证图像导入、转换、构建、材料、下载、缓存和响应式界面。Node 与真实浏览器已验证超过 4 GiB 的实际内存地址、预览读取和四线程计算；并未进行 16 GiB 实物数据或设备内存压力测试，也未代表所有浏览器支持。
导出通过独立解析器检查结构语义；未宣称每种格式都已在 Minecraft 游戏内逐一导入验证。

## 移植修复

- pthread 分发颜色匹配，提供每个线程的实际处理计数。
- 标准字符串诊断封装替代核心 Qt 翻译依赖，适配 Memory64、Eigen 索引及 BigInt 指针 ABI；验证高地址预览与有界 UTF-8 解码。
- Web 路径真正调用遗传转换器，修复其调色板未初始化问题。
- 修复缓存加载空实现、成功条件反向及抖动状态恢复遗漏。
- 区分禁用地图基色和保留该基色的辅助实体方块，确保搭桥／支撑材质不会变成空气。
- 修复水高度范围未登记、首行水遗漏及高度平移偏移；回归验证原 11／6／1 格水深和玻璃容器。
- 修复索引 PNG 的透明通道展开，图标和施工图纹理与原 PNG 逐像素对应。

## 许可证与源码

沿用 GPL-3.0-or-later，保留原作者声明。
发布目录中的 `SlopeCraft-Web-source.zip` 提供修改版源码、构建脚本、依赖锁及对应依赖源码，`assets/licenses/` 提供依赖许可证。
第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

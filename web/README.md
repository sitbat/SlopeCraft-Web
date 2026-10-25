# SlopeCraft Web

[SlopeCraft Web](https://github.com/sitbat/SlopeCraft-Web) 是独立的纯静态网页移植仓库，基于 SlopeCraft 5.4.1（上游提交 `d4cda09853fe83141e155cb3a5280ce22ad9cd3a`）。
本仓库 Git 历史从 Web 初始源码快照开始，不继承上游提交历史；只保留 Web 所需的 C++ 组件、方块资源和预设。
原作者版权与 GPL 声明保留，来源说明见 [UPSTREAM.md](../UPSTREAM.md)。
图片、方块包、转换、三维构建、缓存与导出均在浏览器本地处理，不需要计算后端、账号或数据库服务器。
核心保留原 C++23 算法，以 Emscripten 编译为 WebAssembly，开启 SIMD 与 pthreads。
网页界面参照原程序的三个工作步骤实现，只提供多线程构建。

## 使用构建产物

将 `web/dist/` 的全部内容作为同一站点的静态文件托管。旁边的 `SlopeCraft-Web-static.zip` 是同一目录的部署压缩包。
支持站点根目录或子目录，运行时资源均使用相对 URL，不依赖 CDN。
运行不需要 Node、Python、Qt 或 Emscripten。

网络、证书、跳转与服务器配置由部署者负责，本项目不修改这些设置。
浏览器运行条件为 HTTPS 安全上下文、WebAssembly SIMD、Web Worker、SharedArrayBuffer 和跨源隔离。
部署者需要提供适当的 COOP/COEP 响应头；单独使用 HTTPS 不会自动使 `crossOriginIsolated` 为真。
设置对话框显示实际环境状态，不满足条件时明确报错，不加载单线程替代品。

## 功能

1. 配置：十二个 Java 版本（1.12–1.21、26.1.2、26.2），立体／平面／纯文件地图画；原版、自定义和 Quark 三个内置方块库（336 个方块），四套原版预设，自定义预设导入导出，逐基色选择与批量材质偏好；当前颜色表查看／PNG／CSV，以及方块列表测试结构导出。
2. 图像：多文件导入、拖放、粘贴、项目池、多选、替换／删除、裁切缩放与恢复原图；RGB、RGB+、HSV、XYZ、Lab94、Lab00、遗传算法及参数；抖动、透明像素策略；原图／转化／对照预览、缩放、地图网格与 PNG 下载。
3. 构建：无损／有损压缩、高度上限、玻璃搭桥与间隔、防火、防末影人、蘑菇连接、辅助支撑块；材料用量、组数和 CSV 导出、压缩后图像预览。
4. 导出：Litematica、原版结构 NBT、WorldEdit Sponge schematic、带真实方块纹理的平面施工图、地图数据文件及编号、原生地图命令、十二种朝向／旋转的展示框装裱地图（NBT／Litematica）；名称、区域、偏移、所需模组、空气处理、物品组件版本、发光／固定／隐形展示框等选项。
5. 批量：当前／全部转换、选中／全部导出、地图编号连续分配，多文件 ZIP 打包，停止后续任务。
6. 缓存与设置：IndexedDB 保存原核心 cereal／zstd 快照，保存成功后释放 C++ 图片和三维矩阵，下次构建／导出自动恢复；查看及清理本次任务的缓存。设置自动保存在本地，可导入导出。

设置或图像变化后，旧结果失效，导出时自动重新计算。
计算缓存用于降低当前项目池内存占用；刷新页面不恢复图像项目池，原图应另行保留。
停止按钮在当前 C++ 调用完成后停止后续项目，不强制中断正在计算的结构。

## 桌面版差异

- 文件选择、下载和浏览器存储替代任意本地路径访问与打开文件夹；没有桌面自动更新、操作系统内存探测。
- 覆盖 SlopeCraft 主程序的 Web 功能。VisualCraft、独立 MapViewer 和独立 imageCutter 没有一并移植，其桌面程序源码不包含在本仓库；网页内提供图片裁切和缩放。
- 保留原稠密三维矩阵，未宣称大图无限内存或手机与桌面性能等同。默认预算 1536 MiB，可调整到 128–3072 MiB；预算是预检查阈值，不保证浏览器能分配该数量。过大任务应缩小或拆分。
- 浏览器决定可解码的图像格式；网页主要界面为中文。
- WorldEdit 不支持 Java 1.12，与上游相同。平面施工图仅用于平面地图画。

## 构建和验证

需要 Node 22+、CMake 3.29+、Ninja，以及安装并激活的 Emscripten 4.0.23。
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

默认构建目录 `build/web` 可用 `SC_BUILD_DIR` 更改，`SC_BUILD_JOBS` 控制编译并行度。
`node web/scripts/package-dependencies.mjs` 从同一构建目录收集对应依赖源码和许可证，再由静态打包脚本生成包含这些文件的源码包。当前没有已发布的 Release 或版本标签。
本机验收使用 `node web/scripts/preview.mjs`，只监听回环地址。它是开发工具，不是生产服务器配置。

实际引擎和独立格式解析测试通过 113 项，检查范围及证据限制见 [tests/parity-checklist.md](tests/parity-checklist.md)。
基准用 `node web/tests/benchmark.mjs` 重现；[test-results/benchmark-node.json](test-results/benchmark-node.json) 是 Node WASM 单次测量，不能当作浏览器或手机性能。
浏览器另行验证图像导入、转换、构建、材料、下载、缓存和响应式界面。
导出通过独立解析器检查结构语义；未宣称每种格式都已在 Minecraft 游戏内逐一导入验证。

## 移植修复

- pthread 分发颜色匹配，提供每个线程的实际处理计数。
- 标准字符串诊断封装替代核心 Qt 翻译依赖，适配 wasm32 和 Eigen 索引。
- Web 路径真正调用遗传转换器，修复其调色板未初始化问题。
- 修复缓存加载空实现、成功条件反向及抖动状态恢复遗漏。
- 区分禁用地图基色和保留该基色的辅助实体方块，确保搭桥／支撑材质不会变成空气。
- 修复水高度范围未登记、首行水遗漏及高度平移偏移；回归验证原 11／6／1 格水深和玻璃容器。
- 修复索引 PNG 的透明通道展开，图标和施工图纹理与原 PNG 逐像素对应。

## 许可证与源码

沿用 GPL-3.0-or-later，保留原作者声明。
发布目录中的 `SlopeCraft-Web-source.zip` 提供修改版源码、构建脚本、依赖锁及对应依赖源码，`assets/licenses/` 提供依赖许可证。
第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

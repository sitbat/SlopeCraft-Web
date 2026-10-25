> 上游桌面版文档归档，来自 [SlopeCraft/SlopeCraft 的提交 d4cda09853fe](https://github.com/SlopeCraft/SlopeCraft/tree/d4cda09853fe83141e155cb3a5280ce22ad9cd3a)。下文的安装、发布和编译说明针对原桌面程序；网页移植项目请看[当前主页](../../README.md)。归档中的原项目链接与作者归属保留。

**中文** | [English](README.en.md) <!-- lang -->

![SlopeCraft logo](https://raw.githubusercontent.com/SlopeCraft/SlopeCraft/d4cda09853fe83141e155cb3a5280ce22ad9cd3a/docs/SlopeCraft_ba-style@nulla.top.png)

<p align="center">
  <b>生成多种样式的 Minecraft 地图画！</b>
</p>

<p align="center">
    <img src="https://img.shields.io/badge/Minecraft-1.12~26.2-green?style=for-the-badge" />
    <a href="https://github.com/SlopeCraft/SlopeCraft/blob/d4cda09853fe83141e155cb3a5280ce22ad9cd3a/LICENSE">
        <img src="https://img.shields.io/badge/License-GPL--3.0-important?style=for-the-badge" />
    </a>
    <a href="https://github.com/SlopeCraft/Slopecraft/releases/latest">
        <img src="https://img.shields.io/github/v/release/SlopeCraft/SlopeCraft?style=for-the-badge" />
    </a>
    <br />
    <img src="https://img.shields.io/badge/C%2B%2B-23-blue?style=for-the-badge" />
    <img src="https://img.shields.io/badge/Qt-v6.10-brightgreen?style=for-the-badge" />
    <img src="https://img.shields.io/badge/Eigen-v5.0.1-yellowgreen?style=for-the-badge" />
</p>

## 📖 简介

SlopeCraft 是一款基于 Qt + Eigen + zlib 开发的，用于在 Minecraft 中生成立体地图画的软件。

与 Spritecraft 等像素画软件不同，SlopeCraft 是专门面向地图的像素画生成器，它设计的目的就是让你用地图将像素画记录下来，然后贴在物品展示框上。（这里地图指游戏中可以记录地形的物品，而不是存档。）

所以，SlopeCraft 的颜色调整模块是完全面向地图的，它不是为了让像素画在玩家视角中接近原图，而是为了让像素画在地图的“视角”中接近原图。

由于地图中的颜色与方块的相对高度有关，所以 SlopeCraft 生成地图画往往不是平板的，而是立体的，是人工地形。我们将其称为立体地图画。

一言以蔽之，SlopeCraft 是为地图而设计的。

正是因此，利用 SlopeCraft 制作的地图画的“画质”，比 Spritecraft 导出、再用地图记录的地图画要好很多 —— 因为专业。

## ⚙️ 安装方法

1. 从 [Release](https://github.com/SlopeCraft/SlopeCraft/releases/latest) 页面下载最新版本的 SlopeCraft。

2. 运行 SlopeCraft
    - Windows 用户：下载 `SlopeCraft-x.x.x-win64.zip`，解压后运行 `SlopeCraft.exe`
    - macOS 用户：下载 `SlopeCraft-x.x.x-mac.zip`，解压后将 `SlopeCraft.app` 拖入应用程序文件夹并运行 `SlopeCraft`
    - Linux 用户：下载 `SlopeCraft-x.x.x-Linux.tar.xz`，解压后运行 `SlopeCraft`

   ::: tips
   此处的 `x.x.x` 为 SlopeCraft 的版本号，例如 `5.0.0`。

3. 在进行任何操作前，请确保你已经阅读了 [常见问题](https://slopecraft.readthedocs.io/faq/) 和使用教程。

## 🗃️ 相关文档

### 常见问题

- [常见问题](https://slopecraft.readthedocs.io/faq/)

### 使用教程

- [SlopeCraft 使用教程](https://slopecraft.readthedocs.io/SlopeCraft-tutorial/)
- [VisualCraft 使用教程](https://slopecraft.readthedocs.io/VisualCraft-tutorial/)

### 原理介绍

- [地图画原理](https://slopecraft.readthedocs.io/principles-introduction/)

### 自行编译

- 如果你希望自己编译 SlopeCraft，可以参考 [编译指南](https://slopecraft.readthedocs.io/compilation-guide/) 进行操作。

## 🛠️ 其他相关仓库

- [NBTWriter](https://github.com/ToKiNoBug/NBTWriter-of-Toki) - 写 NBT 文件的库（自己写的，功能比较弱，满足自己的需求就够了）
- [SlopeCraftCompressLib](https://github.com/ToKiNoBug/SlopeCraftCompressLib) - 无损压缩库，也承担了构建高度矩阵的功能
- [SlopeCraftLossyCompression](https://github.com/ToKiNoBug/SlopeCraftLossyCompression) - 有损压缩库，基于无损压缩库实现
- [SlopeCraftGlassBuilder](https://github.com/ToKiNoBug/SlopeCraftGlassBuilder) - 搭桥库
- [HeuristicFlow](https://github.com/TokiNoBug/HeuristicFlow) - 遗传算法实现

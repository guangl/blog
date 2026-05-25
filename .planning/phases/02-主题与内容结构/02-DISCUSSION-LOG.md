# Phase 2: 主题与内容结构 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-25
**Phase:** 2-主题与内容结构
**Areas discussed:** 头像与个人信息, 分类页面实现方式, 导航菜单结构, GitHub Pages URL 配置

---

## 头像与个人信息

**头像来源:**

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub 头像 URL | https://github.com/guangl.png — 无需管理本地文件，自动同步 GitHub 头像。 | ✓ |
| 本地图片文件 | 把头像放到 source/images/，完全控制，不依赖外部 URL。 | |

**用户选择:** GitHub 头像 URL

**个人简介:**

| Option | Description | Selected |
|--------|-------------|----------|
| 全栈工程师，主攻 Rust | 简洁技术定位，匹配博客内容方向。 | |
| 记录技术成长、工程实践与生活思考。 | 展示博客内容涵盖范围。 | |
| 自定义 | 用户自定义输入。 | ✓ |

**用户提供:** `记录技术成长、工程实践与生活思考。`

---

## 分类页面实现方式

| Option | Description | Selected |
|--------|-------------|----------|
| Hexo 原生 categories | 文章 front-matter 加 `category`，hexo-generator-category 自动生成分类页面。已安装，零配置。 | ✓ |
| 手动创建 source 页面 | 在 source/ 下为每个分类建 index.md，更灵活但需手动维护。 | |

**用户选择:** Hexo 原生 categories

---

## 导航菜单结构

**菜单布局:**

| Option | Description | Selected |
|--------|-------------|----------|
| 四分类直接展示 | 技术教程、项目心得、读书笔记、个人思考 — 直接点击进入分类页。清晰直接。 | ✓ |
| 博客总入口 + 分类筛选 | 一个"博客"入口，进入后再按分类筛选。需要额外配置 nav_tabs。 | |

**用户选择:** 四分类直接展示

**关于页面:**

| Option | Description | Selected |
|--------|-------------|----------|
| 不加 | v1 专注内容分类，关于页面后续添加。 | ✓ |
| 加入关于页面 | 导航栏 5 个入口，但关于页内容也需要创建。 | |

**用户选择:** 不加

---

## GitHub Pages URL 配置

| Option | Description | Selected |
|--------|-------------|----------|
| guangluo | url: https://guangluo.github.io | |
| guangl | url: https://guangl.github.io | ✓ |
| 其他 | 用户自定义。 | |

**用户选择:** guangl → `https://guangl.github.io`

---

## Claude's Discretion

- menubar 各分类使用的 Solar 图标（在 Stellar 支持的 Solar 图标库中选择语义相关的）
- `_config.stellar.yml` 中 leftbar、rightbar 等细节参照 Stellar 默认值

## Deferred Ideas

None — discussion stayed within phase scope

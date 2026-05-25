# Phase 3: 内容与 SEO - Research

**Researched:** 2026-05-25
**Domain:** Hexo 文章创建 / Stellar open_graph / hexo-generator-sitemap
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** 创建 1–2 篇占位示例文章（非全部四个分类各一篇），内容犯题即可，3–5 段居。
- **D-02:** 文章格式：占位示例性质，不需要真实深度内容，重点验证分类结构正确运作。
- **D-03:** 文章标题由 Claude 自行取题，符合对应分类主题即可。
- **D-04:** 验收标准调整（用户主动放宽）：原 ROADMAP "四个分类各有至少一篇" → 调整为 "至少 1–2 篇示例文章，分类标注正确"。
- **D-05:** 使用 Stellar 主题内置的 Open Graph 支持（`open_graph.enable: true`），无需额外插件。
- **D-06:** og:description 使用 Hexo open_graph helper 自动从文章内容提取，无需在每篇文章 front-matter 中手动写 description。
- **D-07:** 在 `_config.stellar.yml` 中确认 `open_graph.enable: true`（Stellar 默认值已为 true，确认不被覆盖为 false 即可）。
- **D-08:** 安装 `hexo-generator-sitemap` 插件（`bun add hexo-generator-sitemap`）。
- **D-09:** 使用默认配置，无需排除规则或额外设置，安装后 `bun run build` 自动生成 `public/sitemap.xml`。

### Claude's Discretion

- 1–2 篇文章具体选哪个分类（建议选「技术教程」和「个人思考」，覆盖技术类和非技术类各一篇）
- 文章具体标题和内容（主题符合分类即可，示例性质）

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONT-03 | 每个分类至少有一篇真实示例文章 | D-04 已放宽为 1–2 篇；Hexo front-matter `category` 字段 + hexo-generator-category 自动归类 |
| SEO-01 | Open Graph 元数据配置（og:title、og:description） | Stellar 主题内置 `open_graph.enable: true`；Hexo open_graph helper 自动生成标签 |
| SEO-02 | sitemap.xml 自动生成并在构建输出中可见 | hexo-generator-sitemap 插件，默认输出 `public/sitemap.xml` |

</phase_requirements>

---

## Summary

Phase 3 有三项独立任务：创建示例文章、确认 Open Graph 配置、安装 sitemap 插件。技术层面均已有明确路径，无需做架构决策。

**关键发现：** Phase 3 依赖 Phase 1（bun 迁移）和 Phase 2（四个分类名称、`_config.stellar.yml` 配置），但目前 Phase 1 尚未执行（`bun.lockb` 不存在，仍是 pnpm），因此 Phase 3 必须在 Phase 1、2 完成后才能执行。安装命令为 `bun add hexo-generator-sitemap`，前提是 bun 已成为项目包管理器。

**Primary recommendation:** 按顺序完成三个子任务——写文章（含正确 front-matter）、确认 OG 配置已启用、安装 sitemap 插件。

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 文章内容创建 | Static files (source/_posts/) | — | Hexo 静态生成架构，内容即文件 |
| 分类归类 | Build-time (hexo-generator-category) | — | 插件在构建时读取 front-matter 生成分类页 |
| Open Graph 标签 | Build-time (Stellar theme template) | — | head.ejs 在构建时调用 open_graph() helper 生成 HTML |
| Sitemap 生成 | Build-time (hexo-generator-sitemap) | — | 构建阶段输出 public/sitemap.xml |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| hexo-generator-sitemap | 3.0.1 | 构建时生成 sitemap.xml | hexojs 官方组织维护，Hexo 生态标准 sitemap 方案 [VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| hexo-generator-category | ^2.0.0 | 生成分类页面 | 已安装，无需额外操作 [VERIFIED: package.json] |
| hexo-theme-stellar | ^1.33.1 | 提供 open_graph 模板支持 | 已安装，open_graph.enable 默认 true [VERIFIED: theme _config.yml] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| hexo-generator-sitemap | 手写 sitemap.xml | 不可接受——需要手动维护，无法跟踪新文章 |
| Stellar 内置 OG | hexo-auto-canonical 等额外插件 | 不必要——Stellar 已内置，D-05 已锁定 |

**Installation:**
```bash
bun add hexo-generator-sitemap
```

**Version verification:**
```
npm view hexo-generator-sitemap version
# => 3.0.1 (verified 2026-05-25)
# Created: 2012-10-09 (13+ years in ecosystem)
# Modified: 2026-05-15
```

## Package Legitimacy Audit

> slopcheck 在当前环境不可用，已进行手动审核替代。

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| hexo-generator-sitemap | npm | 13+ 年 (2012) | 高（hexojs 官方，Hexo 生态核心） | github.com/hexojs/hexo-generator-sitemap | N/A | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none

**Packages flagged as suspicious [SUS]:** none

**说明：** slopcheck 不可用，但 hexo-generator-sitemap 通过以下多重验证认定为可信：
- 属于 hexojs 官方 GitHub 组织
- npm 创建于 2012 年（超过 13 年历史）
- 2026-05-15 有最新更新
- 无 postinstall script [VERIFIED: npm view]
- 官方文档明确推荐

## Architecture Patterns

### System Architecture Diagram

```
source/_posts/文章.md
  (front-matter: category, title, date)
         |
         v
  hexo generate
         |
    +----+----+
    |         |
    v         v
hexo-          hexo-
generator-     generator-
category       sitemap
    |               |
    v               v
public/         public/
categories/     sitemap.xml
技术教程/
    |
    v
Stellar head.ejs
  open_graph(og_args())
         |
         v
public/文章路径/index.html
  <meta property="og:title" ...>
  <meta property="og:description" ...>
```

### Recommended Project Structure

```
source/_posts/
├── hello-world.md           # 已存在（无 category，可忽略或更新）
├── 技术教程-示例文章.md       # Phase 3 新建，category: 技术教程
└── 个人思考-示例文章.md       # Phase 3 新建，category: 个人思考

_config.stellar.yml          # 确认 open_graph 未被覆盖为 false
_config.yml                  # 添加 sitemap: 配置（可选）
package.json                 # 新增 hexo-generator-sitemap 依赖
```

### Pattern 1: 文章 front-matter 格式（含 category）

**What:** Hexo 文章必须在 YAML front-matter 中声明 `category` 才能被 hexo-generator-category 归类。

**When to use:** 每篇新建文章。

**Example:**
```markdown
---
title: 从零开始学 Rust：所有权机制详解
date: 2026-05-25 10:00:00
category: 技术教程
tags:
  - Rust
  - 系统编程
---

所有权（Ownership）是 Rust 最核心的概念之一...
```

**关键细节：**
- 字段名用 `category`（单数），不是 `categories`（复数），单分类文章用单数形式更简洁 [ASSUMED]
- 分类名必须与 Phase 2 决策完全一致：`技术教程`、`项目心得`、`读书笔记`、`个人思考`

### Pattern 2: Stellar open_graph 启用确认

**What:** Stellar 主题默认 `open_graph.enable: true`，只需确保 `_config.stellar.yml` 未覆盖为 false。

**Verified behavior** (from `layout/_partial/head.ejs`):
```javascript
// head.ejs 第 130-132 行：
if (theme.open_graph && theme.open_graph.enable) {
  <%- open_graph(og_args()) %>
}
```

**og_args() 函数行为** (已验证源码):
- `args.image` = `config.avatar`（Phase 2 设置的 GitHub 头像 URL）
- 合并 `page.open_graph`（文章 front-matter 中的 open_graph 覆盖，默认无需设置）

**Hexo open_graph helper 标签生成** (已验证源码):
- `og:title` = `page.title`（文章 front-matter 的 title 字段）
- `og:description` = `page.description` → `page.excerpt` → 文章正文前 200 字（自动截断并 strip HTML）
- `og:url` = 文章完整 URL
- `og:type` = `article`（文章页）

**_config.stellar.yml 确认：** 目前文件内容为空（单行），默认值生效。若 Phase 2 未写入 `open_graph` 相关配置，Phase 3 只需不引入覆盖即可。

### Pattern 3: hexo-generator-sitemap 配置

**What:** 安装后默认行为即满足需求，无强制额外配置。

**默认输出:** `public/sitemap.xml`（无需额外 `_config.yml` 配置）

**可选 _config.yml 配置：**
```yaml
sitemap:
  path: sitemap.xml    # 默认值，可省略
  tags: true           # 默认值，标签页包含在 sitemap 中
  categories: true     # 默认值，分类页包含在 sitemap 中
```

**D-09 决策确认:** 不需要排除规则，使用默认配置即可。

### Anti-Patterns to Avoid

- **不要在每篇文章 front-matter 写 description：** D-06 已决定由 Hexo helper 自动提取前 200 字。手动写 description 只在内容不自然时才有必要。
- **不要使用 categories 数组语法（除非需要多级分类）：** 单层分类使用 `category: 技术教程`，不需要嵌套数组。
- **不要在 `_config.stellar.yml` 写空的 open_graph 块：** 若写了 `open_graph:` 但没有 `enable: true`，可能导致 `theme.open_graph` 为对象但 `theme.open_graph.enable` 为 undefined，模板条件可能失效。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| sitemap 生成 | 手写 public/sitemap.xml | hexo-generator-sitemap | 静态文件不跟踪新文章，官方插件在构建时自动更新 |
| OG 标签 | 在 front-matter 写 inject.head | Stellar 内置 open_graph helper | 已有完整实现，手写容易遗漏 og:url、og:type 等字段 |

## Common Pitfalls

### Pitfall 1: category 字段拼写错误或与 Phase 2 分类名不一致

**What goes wrong:** 文章被归入 `uncategorized` 或生成新的非预期分类，分类页 URL 不匹配导航菜单链接。

**Why it happens:** Hexo 分类名区分大小写和全半角，`技术教程` 和 `技 术教程` 是两个不同分类。

**How to avoid:** 文章 front-matter 的分类名从 Phase 2 CONTEXT.md D-04 直接复制粘贴。

**Warning signs:** `bun run server` 后访问 `/categories/技术教程/` 显示 404 或文章数为 0。

### Pitfall 2: 文章内容太少导致 og:description 为空

**What goes wrong:** open_graph helper 提取前 200 字时内容不足（只有一行），og:description 输出为空或非常短。

**Why it happens:** D-06 依赖自动提取，前提是文章有实质性正文。

**How to avoid:** 每篇文章保证至少 3 段落（共约 200 字以上）正文，符合 D-01「3–5 段」要求。

**Warning signs:** `bun run build` 后在 HTML 中 `grep "og:description"` 显示 content 为空。

### Pitfall 3: bun 迁移未完成导致 bun add 失败

**What goes wrong:** Phase 3 执行时仍在 pnpm 环境，`bun add hexo-generator-sitemap` 会生成 `bun.lockb` 但项目依赖可能不一致。

**Why it happens:** 当前 `bun.lockb` 不存在，`pnpm-lock.yaml` 仍存在，说明 Phase 1 未完成。

**How to avoid:** 严格按阶段顺序执行：Phase 1（bun 迁移）→ Phase 2（主题配置）→ Phase 3（内容与 SEO）。

**Warning signs:** 执行 `bun add` 时提示缺少 `bun.lockb` 或出现与 pnpm 的锁文件冲突。

### Pitfall 4: _config.stellar.yml 写入 open_graph 时格式错误

**What goes wrong:** 写了 `open_graph:` 而没有子字段 `enable: true`，或缩进错误。

**Why it happens:** D-07 说"确认不被覆盖为 false"，如果当前文件为空（已确认），最简单的做法是不写任何内容（默认值生效）。

**How to avoid:** 若 Phase 2 未在 `_config.stellar.yml` 写入 open_graph 配置，Phase 3 不需要操作该文件（保持默认即可）。

## Code Examples

### 技术教程分类文章示例

```markdown
---
title: Rust 所有权机制：从零理解内存安全
date: 2026-05-25 10:00:00
category: 技术教程
tags:
  - Rust
  - 内存管理
---

Rust 最独特的特性是所有权（Ownership）系统，它在编译期保证内存安全，无需垃圾回收器。本文通过几个简单示例说明所有权的核心规则。

## 所有权三原则

Rust 中每个值都有一个所有者，同一时刻只能有一个所有者，当所有者离开作用域时值被丢弃。这三条规则共同构成了 Rust 内存安全的基础。

...（其余段落保证总字数 200 字以上以支持 og:description 自动提取）
```

### 验证 OG 标签的 shell 命令

```bash
# 构建后检查某篇文章的 OG 标签
bun run build
grep -A1 "og:title\|og:description" public/2026/05/25/rust-ownership/index.html

# 确认 sitemap 存在
ls -la public/sitemap.xml
```

### 默认 _config.yml 无需修改（sitemap 使用默认路径）

安装 hexo-generator-sitemap 后无需修改 `_config.yml`，插件自动注册并在 `bun run build` 时输出 `public/sitemap.xml`。

若需要显式配置（可选）：
```yaml
# _config.yml — 可选，安装插件后默认已生效
sitemap:
  path: sitemap.xml
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 手动维护 sitemap.xml | hexo-generator-sitemap 构建时自动生成 | Hexo 插件生态建立之初 | 文章增减无需手动更新 |
| 手写 OG meta 标签 | Hexo open_graph() helper + 主题模板 | Hexo helper 系统成熟后 | 单点配置，自动适配所有文章页 |

**Deprecated/outdated:**
- 在 `<head>` 里手写 `<meta property="og:...">` 标签：在 Hexo + Stellar 组合中不需要，主题已处理。

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `category` 单数字段适用于单分类归类（非数组语法） | Code Examples | 若 hexo-generator-category 要求 `categories` 数组，文章不会被正确归类。风险低：Hexo 文档两种写法均支持 |
| A2 | Phase 2 完成后 `_config.stellar.yml` 不包含 open_graph 覆盖配置 | Pitfall 4 | 若 Phase 2 写入了 `open_graph: enable: false`，Phase 3 需要额外修正该文件 |

**备注:** A1 风险极低，Hexo 官方文档明确 `category: xxx` 语法有效；A2 取决于 Phase 2 执行结果。

## Open Questions

1. **Phase 2 执行后 `_config.stellar.yml` 的实际内容**
   - What we know: 当前文件为空，Phase 2 将写入 logo/menubar/profile 配置
   - What's unclear: Phase 2 是否会包含 `open_graph` 相关行
   - Recommendation: Phase 3 执行前检查 `_config.stellar.yml`，若存在 `open_graph.enable: false` 则删除该行；若文件无 open_graph 配置则不需任何操作

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| bun | D-08: `bun add hexo-generator-sitemap` | ✓ | 1.3.9 | — |
| pnpm（当前状态） | 当前依赖安装 | ✓ | — | bun（Phase 1 完成后取代） |
| node/hexo CLI | `bun run build` | ✓ | hexo 8.1.2 | — |

**注意:** `bun.lockb` 当前不存在（Phase 1 尚未执行），Phase 3 的 `bun add` 命令必须在 Phase 1 完成后执行。

**Missing dependencies with no fallback:** 无（bun 已安装）

**Missing dependencies with fallback:** 无

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Hexo 构建验证（shell 命令，无 JS 测试框架） |
| Config file | none（静态站点，不使用 jest/vitest） |
| Quick run command | `bun run build && ls public/sitemap.xml` |
| Full suite command | `bun run build && grep -r "og:title" public/ \| head -5` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONT-03 | 文章在正确分类页出现 | smoke | `bun run build && ls public/categories/技术教程/` | ❌ Wave 0 |
| SEO-01 | og:title 和 og:description 在文章 HTML head 中存在 | smoke | `bun run build && grep "og:title" public/2026/*/index.html \| head -3` | ❌ Wave 0 |
| SEO-02 | public/sitemap.xml 在构建后存在 | smoke | `bun run build && test -f public/sitemap.xml && echo PASS` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bun run build`（确认无构建错误）
- **Per wave merge:** `bun run build && ls public/sitemap.xml && ls public/categories/`
- **Phase gate:** 完整构建 + 人工检查任意一篇文章 HTML 的 og 标签

### Wave 0 Gaps

- [ ] 三条验证命令无需额外文件——均为构建后 shell 检查，Wave 0 直接可用
- [ ] 唯一前置条件：文章和插件必须存在（Phase 3 任务本身创建）

## Security Domain

Phase 3 仅涉及静态内容生成（Markdown 文章 + Hexo 构建），无认证、会话、用户输入处理。ASVS 分类不适用于此阶段。

**适用检查：** 文章 Markdown 内容由开发者自己编写，无外部输入，无 XSS 风险。Hexo 的 `escapeHTML` 已内置在 open_graph helper 中（已验证源码第 73 行）。

## Sources

### Primary (HIGH confidence)

- `node_modules/hexo-theme-stellar/_config.yml` 第 23-25 行 — open_graph 默认配置确认
- `node_modules/hexo-theme-stellar/layout/_partial/head.ejs` 第 22-131 行 — open_graph 模板逻辑、og_args()、og:description 来源
- `node_modules/.pnpm/hexo@8.1.2_.../hexo/dist/plugins/helper/open_graph.js` 第 55-76 行 — Hexo open_graph helper 实现（og:title 来自 page.title，og:description 来自 page.description/excerpt/content 前 200 字）
- `package.json` — 已安装依赖确认（hexo-generator-category 已安装，hexo-generator-sitemap 未安装）
- npm view hexo-generator-sitemap — 版本 3.0.1，创建 2012 年，2026-05-15 更新，无 postinstall script

### Secondary (MEDIUM confidence)

- https://github.com/hexojs/hexo-generator-sitemap — 官方 hexojs 组织仓库，配置选项和默认值
- https://hexo.io/docs/helpers.html#open-graph — Hexo 官方文档，open_graph helper 用法

### Tertiary (LOW confidence)

无

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — hexo-generator-sitemap 从 npm registry 确认，官方 hexojs 组织
- Architecture: HIGH — 直接读取 Stellar 主题源码和 Hexo helper 源码验证
- Pitfalls: HIGH — 基于实际文件状态（bun.lockb 不存在、_config.stellar.yml 为空）
- OG 标签行为: HIGH — 直接读取 open_graph.js 源码第 59-76 行

**Research date:** 2026-05-25
**Valid until:** 2026-06-25（hexo-generator-sitemap 稳定库，有效期较长）

# Phase 1: 仓库基础 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-25
**Phase:** 1-仓库基础
**Areas discussed:** LICENSE 类型, README 内容与格式, Bun 迁移边界

---

## LICENSE 类型

| Option | Description | Selected |
|--------|-------------|----------|
| MIT | 最简洁，代码和内容都允许任意使用和修改，保留版权声明即可。最常见的个人博客选择。 | |
| Apache 2.0 | 比 MIT 更正式，明确专利授权、修改声明要求。开源项目常用，对个人博客略显复杂。 | |
| CC BY 4.0 | 内容授权（文章、图片），代码不适用。如果主要关心内容版权而非代码，选这个。 | ✓ |

**用户选择:** CC BY 4.0

**追问 — 代码部分处理方式:**

| Option | Description | Selected |
|--------|-------------|----------|
| CC BY 4.0 应用于全部 | 简单明确，一个 LICENSE 文件。按照协议内容才是主体，配置代码算附属。 | ✓ |
| 双协议：内容 CC BY 4.0 + 代码 MIT | 内容和代码分开授权，更严谨。需要在 README 中说明哪部分用哪个协议。 | |

**用户选择:** CC BY 4.0 应用于全部

---

## README 内容与格式

**语言版本:**

| Option | Description | Selected |
|--------|-------------|----------|
| 纯中文 | 博客定位中文读者，README 中文即可。简单、一致。 | ✓ |
| 中英双语言 | 同时提供中英文，体积增加，维护成本更高。 | |

**用户选择:** 纯中文

**徽章:**

| Option | Description | Selected |
|--------|-------------|----------|
| 不要徽章 | CI 还未配置，徽章内容不完整。后面待 CI 流水线搞好再加。 | ✓ |
| 加技术栈徽章 | Hexo、Stellar、bun 等技术栈徽章，不依赖 CI 状态。 | |

**用户选择:** 不要徽章

**额外内容:**

| Option | Description | Selected |
|--------|-------------|----------|
| 仅所需内容 | 项目说明、本地运行、技术栈 — 对应 REPO-01，不多不少。 | ✓ |
| 加部署说明 | 加上 GitHub Pages URL 和部署说明。此时部署还没配置，内容可能不准确。 | |
| 加内容结构说明 | 说明四个内容分类，方便访客了解博客结构。 | |

**用户选择:** 仅所需内容

---

## Bun 迁移边界

**CLAUDE.md 更新:**

| Option | Description | Selected |
|--------|-------------|----------|
| 是，同步更新 CLAUDE.md | CLAUDE.md 是 Claude Code 的指导文件，命令应与实际工具链一致。 | ✓ |
| 不更新 | bun 兼容 pnpm 语法，不影响使用。 | |

**用户选择:** 是，同步更新 CLAUDE.md

**pnpm-workspace.yaml 处理:**

| Option | Description | Selected |
|--------|-------------|----------|
| 删除 | Hexo 单仓库，不需要 workspace 配置。删除后更干净。 | ✓ |
| 保留 | 无害但确实不必要，可能造成困惑。 | |

**用户选择:** 删除

---

## Claude's Discretion

- README 的具体措辞和排版
- CC BY 4.0 LICENSE 文件的标准模板文本（年份和作者名：2026 Guang Luo）

## Deferred Ideas

None — discussion stayed within phase scope

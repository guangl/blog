# Phase 4: 自动部署 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-25
**Phase:** 4-自动部署
**Areas discussed:** GitHub Actions 部署方式, Bun 安装配置, 触发条件

---

## GitHub Actions 部署方式

| Option | Description | Selected |
|--------|-------------|----------|
| peaceiris/actions-gh-pages | 成熟的社区 Action，推 build 产物到 gh-pages 分支，配置简单，文档丰富 | |
| GitHub 官方 actions/deploy-pages | 官方方案，需配置 Pages 来源为 GitHub Actions，流程稍复杂一些 | ✓ |

**User's choice:** GitHub 官方 actions/deploy-pages

**Notes:** 需要在仓库设置中将 GitHub Pages 来源改为 "GitHub Actions"，并在 workflow 中声明 `pages: write`、`id-token: write` 权限。

---

## Bun 安装配置

| Option | Description | Selected |
|--------|-------------|----------|
| oven-sh/setup-bun（推荐） | Bun 官方提供的 Action，`uses: oven-sh/setup-bun@v2`，直接指定版本即可 | ✓ |
| 手动安装脚本 | `curl -fsSL https://bun.sh/install | bash`，不依赖第三方 Action | |

**User's choice:** oven-sh/setup-bun（推荐）

---

## 触发条件

| Option | Description | Selected |
|--------|-------------|----------|
| 只在 push main 时触发（推荐） | 最简单的单一触发条件，小博客项目完全够用 | ✓ |
| push main + 手动触发（workflow_dispatch） | 附加手动触发，应对置配变更不想推代码的情况 | |

**User's choice:** 只在 push main 时触发

---

## Node.js 版本

| Option | Description | Selected |
|--------|-------------|----------|
| actions/setup-node 指定版本（推荐） | 明确指定 Node.js 20.x，确保 Hexo 8.x 兼容性和环境可再现 | ✓ |
| 不指定，使用运行器默认版本 | ubuntu-latest 当前默认 Node.js 20，不指定也能正常工作 | |

**User's choice:** actions/setup-node 指定版本（推荐）

---

## Claude's Discretion

- Workflow 文件命名（建议 `.github/workflows/deploy.yml`）
- Job 名称和 step 名称的具体措辞
- bun 版本是否锁定到具体版本号（推荐 `latest` 保持简单）

## Deferred Ideas

None — discussion stayed within phase scope

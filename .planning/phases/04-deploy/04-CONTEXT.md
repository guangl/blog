# Phase 4: 自动部署 - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

配置 GitHub Actions workflow，push 到 main 分支后自动构建（bun + Hexo）并通过 GitHub 官方 actions/deploy-pages 发布到 GitHub Pages。不涉及自定义域名、CDN、或其他托管平台。

</domain>

<decisions>
## Implementation Decisions

### 部署方式
- **D-01:** 使用 GitHub 官方三步方案：`actions/configure-pages` → `actions/upload-pages-artifact` → `actions/deploy-pages`。
- **D-02:** GitHub Pages 来源需在仓库设置中改为 "GitHub Actions"（不是 gh-pages 分支）。
- **D-03:** Workflow 需要显式声明权限：`pages: write`、`id-token: write`、`contents: read`。

### Bun 安装
- **D-04:** 使用 `oven-sh/setup-bun@v2` 安装 bun，可指定版本（如 `bun-version: latest`）。
- **D-05:** 依赖安装命令：`bun install`，构建命令：`bun run build`（对应 `hexo generate`）。

### Node.js 版本
- **D-06:** 使用 `actions/setup-node` 显式指定 Node.js 20.x，确保 Hexo 8.x 兼容性和环境可再现。

### 触发条件
- **D-07:** 只在 `push` 到 `main` 分支时触发，不含 PR 或手动触发。

### Claude's Discretion
- Workflow 文件命名（建议 `.github/workflows/deploy.yml`）
- Job 名称和 step 名称的具体措辞
- bun 版本是否锁定到具体版本号（推荐 `latest` 保持简单）

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 需求定义
- `.planning/REQUIREMENTS.md` — DEPLOY-01 完整需求描述
- `.planning/ROADMAP.md` §Phase 4 — 3 条成功标准

### 前置阶段
- `.planning/phases/01-仓库基础/01-CONTEXT.md` — bun 作为包管理器（D-04、D-05 的依据）
- `.planning/phases/02-主题与内容结构/02-CONTEXT.md` — GitHub Pages URL `https://guangl.github.io`（D-02 的目标域名）

### 外部文档（GitHub Actions）
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site — 配置 Pages 来源为 GitHub Actions
- `oven-sh/setup-bun` GitHub 仓库 — setup-bun@v2 用法

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `package.json` scripts：`build: hexo generate`、`clean: hexo clean` 已定义，workflow 直接调用
- `.gitignore`：`public/` 目录已忽略，构建产物不提交到仓库（正确做法）

### Established Patterns
- 无已有 CI/CD 配置（`.github/` 目录不存在）

### Integration Points
- `.github/workflows/deploy.yml`：需新建此文件
- GitHub 仓库设置：需将 Pages 来源改为 "GitHub Actions"（仓库 Settings → Pages → Source）
- `public/`：`bun run build` 的输出目录，作为 `upload-pages-artifact` 的上传路径

</code_context>

<specifics>
## Specific Ideas

- Workflow 基本结构：
  ```
  触发：push → main
  Job permissions：pages: write, id-token: write, contents: read
  Steps：
    1. checkout
    2. setup-node (20.x)
    3. setup-bun (latest)
    4. bun install
    5. bun run build
    6. configure-pages
    7. upload-pages-artifact (path: public/)
    8. deploy-pages
  ```

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 4-自动部署*
*Context gathered: 2026-05-25*

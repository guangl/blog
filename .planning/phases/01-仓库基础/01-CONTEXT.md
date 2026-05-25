# Phase 1: 仓库基础 - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

建立仓库基础文件（README、LICENSE）并将包管理器从 pnpm 迁移到 bun。不涉及主题配置、内容创建或部署设置。

</domain>

<decisions>
## Implementation Decisions

### LICENSE
- **D-01:** 使用 CC BY 4.0 协议，应用于全部内容（文章）和配置代码，一个 LICENSE 文件。

### README
- **D-02:** 纯中文，不做双语版本。
- **D-03:** 不添加徽章（badges）——CI 尚未配置，徽章内容不完整。
- **D-04:** 内容范围严格对应 REPO-01：项目说明、本地运行步骤、技术栈说明。不加贡献指南、部署说明、内容结构等额外内容。

### Bun 迁移
- **D-05:** 删除 `pnpm-lock.yaml` 和 `pnpm-workspace.yaml`，用 `bun install` 生成 `bun.lockb`。
- **D-06:** CLAUDE.md 的命令示例从 `pnpm run *` 同步更新为 `bun run *`，保持文档与实际工具链一致。

### Claude's Discretion
- README 的具体措辞和排版由 Claude 自行决定，保持简洁专业即可。
- CC BY 4.0 的 LICENSE 文件标准模板文本由 Claude 填入，年份和作者名使用 `2026 Guang Luo`。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 需求定义
- `.planning/REQUIREMENTS.md` — REPO-01、REPO-02、REPO-03 的完整需求描述
- `.planning/ROADMAP.md` §Phase 1 — 成功标准（4条验收条件）

### 项目上下文
- `.planning/PROJECT.md` — Key Decisions 表格中的包管理器迁移决策

### 当前配置
- `CLAUDE.md` — 需要同步更新的命令文档
- `package.json` — 当前 scripts 定义（迁移后无需修改 scripts，只替换锁文件）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `package.json` scripts：`build`、`clean`、`deploy`、`server` 已定义，与 bun 完全兼容，无需修改。

### Established Patterns
- 无已有代码模式需要遵循（Phase 1 是基础设施阶段）。

### Integration Points
- `pnpm-lock.yaml` / `pnpm-workspace.yaml` → 删除，替换为 `bun.lockb`
- `CLAUDE.md` → 命令示例需同步更新

</code_context>

<specifics>
## Specific Ideas

无特殊要求——README 按标准格式撰写，LICENSE 用 CC BY 4.0 官方模板文本。

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 1-仓库基础*
*Context gathered: 2026-05-25*

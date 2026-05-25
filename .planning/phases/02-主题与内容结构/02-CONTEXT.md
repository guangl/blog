# Phase 2: 主题与内容结构 - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

配置 Stellar 主题展示作者身份（头像、姓名、简介），建立四个内容分类体系，配置导航菜单和网站基础元数据。不涉及实际文章内容、SEO Open Graph 或部署配置。

</domain>

<decisions>
## Implementation Decisions

### 头像与个人信息
- **D-01:** 头像使用 GitHub 头像 URL：`https://github.com/guangl.png`，在 `_config.yml` 的 `avatar` 字段设置。
- **D-02:** 个人简介文字：`记录技术成长、工程实践与生活思考。`
- **D-03:** 作者姓名沿用 `_config.yml` 中已有的 `Guang Luo`。

### 内容分类实现
- **D-04:** 使用 Hexo 原生 categories 实现四个分类：技术教程、项目心得、读书笔记、个人思考。
  - 文章 front-matter 中添加 `category: 技术教程`（或对应分类名）
  - `hexo-generator-category` 自动生成 `/categories/技术教程/` 等分类页面
  - 无需手动创建 source 页面

### 导航菜单（menubar）
- **D-05:** menubar 直接展示四个分类入口，无总博客入口，无关于页面。
  - 技术教程 → `/categories/技术教程/`
  - 项目心得 → `/categories/项目心得/`
  - 读书笔记 → `/categories/读书笔记/`
  - 个人思考 → `/categories/个人思考/`
- **D-06:** menubar columns 设为 4（每行 4 个，全部展示）。
- **D-07:** 图标使用 Stellar 内置 Solar 图标库，具体图标由 Claude 自行选择合适的。

### 网站元数据
- **D-08:** `_config.yml` 的 `url` 设置为 `https://guangl.github.io`
- **D-09:** `_config.yml` 的 `description` 和 `keywords` 字段填写基础 SEO 内容。
  - description：`记录技术成长、工程实践与生活思考的个人技术博客。涵盖 Rust 系统编程、全栈开发、读书笔记和个人思考。`
  - keywords：`Rust, 全栈开发, 技术博客, 编程, 系统编程`
- **D-10:** `_config.stellar.yml` 中配置 Stellar 特定的 logo、menubar、profile 等。

### Claude's Discretion
- menubar 各分类的 Solar 图标选择（在合理范围内选相关图标）
- `_config.stellar.yml` 中 leftbar 等细节配置参照 Stellar 默认值

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 需求定义
- `.planning/REQUIREMENTS.md` — CONT-01、CONT-02、THEME-01、THEME-02、THEME-03 完整需求描述
- `.planning/ROADMAP.md` §Phase 2 — 4条成功标准

### 主题配置
- `node_modules/hexo-theme-stellar/_config.yml` — Stellar 主题所有默认配置项，实现时参考 logo、menubar、site_tree 等字段
- `_config.yml` — 站点级配置，url、description、keywords、avatar 在此文件修改
- `_config.stellar.yml` — 主题覆盖配置，当前为空，Phase 2 的主题配置写入此文件

### 前置阶段
- `.planning/phases/01-仓库基础/01-CONTEXT.md` — Phase 1 决策（bun 迁移等）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `hexo-generator-category`：已安装，categories 功能无需额外安装插件。
- `hexo-generator-tag`：已安装，标签体系同样可用。

### Established Patterns
- Hexo 标准目录结构：`source/_posts/`（文章）、`source/_drafts/`（草稿）。
- Stellar 通过 `_config.stellar.yml` 覆盖 `node_modules/hexo-theme-stellar/_config.yml` 默认值。

### Integration Points
- `_config.yml`：修改 url、description、keywords、avatar 字段
- `_config.stellar.yml`：添加 logo、menubar、profile/intro 配置
- 已有的 hello-world 文章需要加上 `category` front-matter 作为示例

</code_context>

<specifics>
## Specific Ideas

- 头像 URL：`https://github.com/guangl.png`（直接指向 GitHub 头像）
- 简介文字：`记录技术成长、工程实践与生活思考。`
- GitHub Pages URL：`https://guangl.github.io`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 2-主题与内容结构*
*Context gathered: 2026-05-25*

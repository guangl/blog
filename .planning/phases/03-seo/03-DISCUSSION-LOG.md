# Phase 3: 内容与 SEO - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-25
**Phase:** 3-内容与 SEO
**Areas discussed:** 文章内容方向, OG / SEO 实现, Sitemap 生成

---

## 文章内容方向

| Option | Description | Selected |
|--------|-------------|----------|
| 真实内容 | 真实的知识点、项目总结、书评、随笔——内容有实际参考价值 | |
| 占位示例 | 短小的 placeholder 文章，内容不重要，重点验证分类结构和 SEO 配置正确 | ✓ |

**User's choice:** 占位示例

| Option | Description | Selected |
|--------|-------------|----------|
| 3–5 段居，内容犯题就行 | 每篇只需展示分类能正常工作，不必费精力写真实内容 | ✓ |
| 100–200 字，简单描述分类主题 | 稍微有些内容，让页面看起来不拟真 | |

**User's choice:** 3–5 段居，内容犯题就行

| Option | Description | Selected |
|--------|-------------|----------|
| Claude 自行取题 | 根据分类主题起合适标题 | ✓ |
| 我指定标题 | 每个分类的文章标题由我来确定 | |

**User's choice:** Claude 自行取题

| Option | Description | Selected |
|--------|-------------|----------|
| 四个分类各一篇（按需求来） | 严格遵守 CONT-03 和 ROADMAP 验收标准 | |
| 只需要 1–2 篇即可 | 验证结构正确即可，不用全部分类都有 | ✓ |

**User's choice:** 只需要 1–2 篇即可（用户主动放宽验收标准）

**Notes:** 验收标准从「四个分类各有至少一篇」调整为「至少 1–2 篇示例文章，分类标注正确」。

---

## OG / SEO 实现

**Codebase finding:** Stellar 主题内置 OG 支持（`layout/_partial/head.ejs` 中有 `open_graph(og_args())` 调用），默认 `open_graph.enable: true`，无需额外插件。

| Option | Description | Selected |
|--------|-------------|----------|
| 自动从文章内容摄取 | Hexo open_graph helper 默认从文章前 N 字提取，无需每篇手动配置 | ✓ |
| 每篇文章手动写 description 字段 | 在 front-matter 中明确写 description，更精准但需手动维护 | |

**User's choice:** 自动从文章内容摄取

---

## Sitemap 生成

**Codebase finding:** `hexo-generator-sitemap` 未安装，需要额外安装。

| Option | Description | Selected |
|--------|-------------|----------|
| 默认配置即可（推荐） | 安装后默认生成 sitemap.xml，无需额外配置 | ✓ |
| 需要配置排除规则 | 设置哪些页面不入 sitemap，比如过滤掉分类、标签页 | |

**User's choice:** 默认配置即可

---

## Claude's Discretion

- 1–2 篇文章具体选哪个分类（建议「技术教程」和「个人思考」）
- 文章具体标题和内容（主题符合分类即可，示例性质）

## Deferred Ideas

None — discussion stayed within phase scope

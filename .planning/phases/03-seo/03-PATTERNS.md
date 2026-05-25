# Phase 3: 内容与 SEO - Pattern Map

**Mapped:** 2026-05-25
**Files analyzed:** 5（新建/修改文件）
**Analogs found:** 3 / 5

## File Classification

| 新建/修改文件 | Role | Data Flow | 最近类比 | 匹配质量 |
|---|---|---|---|---|
| `source/_posts/技术教程-示例文章.md` | content | static | `source/_posts/hello-world.md` | role-match（缺 category 字段） |
| `source/_posts/个人思考-示例文章.md` | content | static | `source/_posts/hello-world.md` | role-match（缺 category 字段） |
| `_config.stellar.yml` | config | static | `_config.yml`（Hexo 主站配置） | partial-match |
| `_config.yml`（可选，sitemap 配置） | config | static | `_config.yml` 自身 | exact（追加字段） |
| `package.json`（新增依赖） | config | static | `package.json` 自身 | exact（追加依赖） |

## Pattern Assignments

### `source/_posts/技术教程-示例文章.md` 和 `source/_posts/个人思考-示例文章.md`（content, static）

**Analog:** `source/_posts/hello-world.md`

**现有 front-matter 格式**（hello-world.md 第 1–4 行）：
```markdown
---
title: Hello World
---
```

**问题：** hello-world.md 缺少 `date`、`tags`、`category` 字段——与 scaffold 默认模板不一致。

**Scaffold 模板**（`scaffolds/post.md` 第 1–5 行）：
```yaml
---
title: {{ title }}
date: {{ date }}
tags:
---
```

**Phase 3 文章必须使用的 front-matter 格式**（在 scaffold 基础上增加 `category`）：
```yaml
---
title: <文章标题>
date: 2026-05-25 10:00:00
category: 技术教程
tags:
  - <tag1>
  - <tag2>
---
```

**关键规则：**
- `category` 字段名用单数（不是 `categories`），值必须与 Phase 2 决策完全一致：`技术教程`、`项目心得`、`读书笔记`、`个人思考`
- `date` 字段必须存在（格式 `YYYY-MM-DD HH:mm:ss`），缺少时 Hexo 使用文件 mtime
- 正文至少 3 段落、共 200 字以上，确保 og:description 自动提取有内容可用（D-06）

**正文内容结构模式**（来自 RESEARCH.md Code Examples 第 283–303 行）：
```markdown
<正文引言段，约 50 字，概括本文主题>

## <子标题>

<第二段，展开核心内容，约 100 字>

## <子标题>

<第三段，总结或延伸，约 50 字>
```

---

### `_config.stellar.yml`（config, static）

**Analog:** `node_modules/hexo-theme-stellar/_config.yml`（Stellar 主题默认配置）

**Stellar 主题默认 open_graph 配置**（`node_modules/hexo-theme-stellar/_config.yml` 第 23–25 行）：
```yaml
open_graph:
  enable: true
  twitter_id: # for open_graph meta
```

**当前 `_config.stellar.yml` 状态：** 文件存在但为空（单行），主题默认值全部生效。

**Phase 3 操作规则：**
- 若 Phase 2 执行后文件仍无 `open_graph` 相关行 → Phase 3 不需要操作该文件
- 若 Phase 2 写入了 `open_graph: enable: false` → 删除该行或改为 `enable: true`
- 禁止写入 `open_graph:` 块但不包含 `enable: true`——会导致 `theme.open_graph.enable` 为 undefined，模板条件 `theme.open_graph && theme.open_graph.enable` 失效

**模板触发逻辑**（`node_modules/hexo-theme-stellar/layout/_partial/head.ejs` 第 130–131 行）：
```javascript
<% if (theme.open_graph && theme.open_graph.enable) { %>
  <%- open_graph(og_args()) %>
```

**og_args() 函数**（`head.ejs` 第 61–71 行）：
```javascript
function og_args() {
  var args = {};
  if (theme.open_graph.twitter_id) {
    args.twitter_id = theme.open_graph.twitter_id;
  }
  if (page.layout == 'post' && page.cover) {
    args.twitter_card = 'summary_large_image';
  }
  args.image = config.avatar || (config.email ? gravatar(config.email) : null);
  return Object.assign(args, page.open_graph);
}
```

---

### `_config.yml`（可选追加 sitemap 配置，config, static）

**Analog:** `_config.yml` 自身（追加字段）

**当前 `_config.yml` 末尾**（第 100–104 行）：
```yaml
# Deployment
## Docs: https://hexo.io/docs/one-command-deployment
deploy:
  type: ""
```

**hexo-generator-sitemap 无需修改 `_config.yml`**（D-09）。安装插件后默认输出 `public/sitemap.xml`。

若需显式配置（可选，按需追加到 `_config.yml`）：
```yaml
# Sitemap
sitemap:
  path: sitemap.xml
```

**追加位置：** `_config.yml` Extensions 区块（第 97–99 行 `# Extensions` 之后）。

---

### `package.json`（新增依赖，config, static）

**Analog:** `package.json` 自身（追加 dependencies 字段）

**当前 `package.json` dependencies**（第 14–26 行）：
```json
"dependencies": {
  "hexo": "^8.0.0",
  "hexo-generator-archive": "^2.0.0",
  "hexo-generator-category": "^2.0.0",
  "hexo-generator-index": "^4.0.0",
  "hexo-generator-tag": "^2.0.0",
  "hexo-renderer-ejs": "^2.0.0",
  "hexo-renderer-marked": "^7.0.0",
  "hexo-renderer-stylus": "^3.0.1",
  "hexo-server": "^3.0.0",
  "hexo-theme-landscape": "^1.0.0",
  "hexo-theme-stellar": "^1.33.1"
}
```

**安装命令**（D-08，Phase 1 bun 迁移完成后执行）：
```bash
bun add hexo-generator-sitemap
```

**预期结果：** `package.json` 中新增 `"hexo-generator-sitemap": "^3.0.1"` 条目，并生成/更新 `bun.lockb`。

---

## Shared Patterns

### Hexo front-matter 约定
**来源：** `scaffolds/post.md`（第 1–5 行）+ `_config.yml`（第 14–18 行）
**应用范围：** 所有新建文章
```yaml
---
title: <标题>
date: YYYY-MM-DD HH:mm:ss
category: <分类名>      # Phase 3 新增字段
tags:
  - <tag>
---
```

**permalink 格式**（`_config.yml` 第 18 行）：
```yaml
permalink: :year/:month/:day/:title/
```
文章文件名决定 URL，例如文件 `技术教程-示例文章.md` → URL `/2026/05/25/技术教程-示例文章/`

### 构建验证命令模式
**来源：** RESEARCH.md Validation Architecture（第 378–395 行）
**应用范围：** 每次任务提交后运行

```bash
# 验证构建无错误 + sitemap 存在
bun run build && test -f public/sitemap.xml && echo "sitemap PASS"

# 验证分类页生成
ls public/categories/技术教程/

# 验证 OG 标签
grep "og:title\|og:description" public/2026/05/25/*/index.html | head -5
```

---

## No Analog Found

| 文件 | Role | Data Flow | 原因 |
|------|------|-----------|------|
| `source/_posts/技术教程-示例文章.md`（含 category） | content | static | 现有 hello-world.md 无 `category` 字段，是较差的模板；正确模板来自 RESEARCH.md Code Examples |
| `source/_posts/个人思考-示例文章.md`（含 category） | content | static | 同上 |

**规划器处理方式：** 使用 RESEARCH.md Pattern 1（第 165–187 行）的 front-matter 格式，以及 Code Examples（第 283–303 行）的正文结构，而非直接复制 hello-world.md。

---

## Metadata

**Analog search scope:** `source/_posts/`、`scaffolds/`、`_config.yml`、`_config.stellar.yml`、`package.json`、`node_modules/hexo-theme-stellar/_config.yml`、`node_modules/hexo-theme-stellar/layout/_partial/head.ejs`
**Files scanned:** 8
**Pattern extraction date:** 2026-05-25

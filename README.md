# 个人摄影学习之路

基于 [Hexo](https://hexo.io/) 和 [Stellar](https://github.com/xaoxuu/hexo-theme-stellar) 的个人站点，用中文记录学习摄影的过程：曝光、构图、后期的练习笔记，以及出门拍到的照片。

线上地址：<https://blog.guangluo.top/>

## 本地运行

### 环境要求

- Node.js 22 或更高版本
- [Bun](https://bun.sh/) 1.4.3（与 CI 一致）

### 安装依赖

```bash
bun install --frozen-lockfile
```

### 启动开发服务器

```bash
bun run server
```

启动后访问 <http://localhost:4000/>。

### 生成静态文件

```bash
bun run build
```

生成的文件位于 `public/` 目录。清理缓存和生成文件：

```bash
bun run clean
```

## 已配置的功能

- 中文导航、关于页、归档、分类与标签，移动端提供直接导航入口。
- Stellar 本地全文搜索、文章字数与阅读时长、代码复制、文章链接分享。
- Stellar 原生浅色 / 深色 / 跟随系统三种外观。
- 全文 Atom 订阅：<https://blog.guangluo.top/atom.xml>。
- 站点地图、robots.txt、规范链接、主题自带的 Open Graph 与结构化数据；所有页面都有 1200×630 的社交卡片图与 `summary_large_image` 卡片（见 [SEO 与分享](#seo-与分享)）。
- 搜索引擎收录支持：站长平台验证 meta、IndexNow 密钥文件、发布后自动推送（见 [SEO 与分享](#seo-与分享)）。
- 响应式图片：构建期给照片生成 JPEG / WebP / AVIF 多档变体，用 `<picture>` + `srcset` 按屏幕宽度取图（见 [图片](#图片)）。
- 安全响应头与缓存策略：构建期生成 Cloudflare Pages 的 `_headers`，含 HSTS、CSP、Permissions-Policy（见 [响应头与缓存](#响应头与缓存)）。
- 无障碍：每页恰好一个 `h1`、每张图都有 `alt`、可缩放的 viewport、「跳到主要内容」链接、首页 Hero 文字对比度 6.27:1（见 [无障碍](#无障碍)）。
- 本地图标（`favicon.ico` 多尺寸 + `apple-touch-icon.png`）与 404 插图；照片提供封面、正文预览图和大图入口。
- 文章和页脚使用与仓库一致的 CC BY 4.0 协议。

## 写文章

```bash
bunx hexo new post "文章标题"
```

编辑 `source/_posts/` 下的 Markdown 文件。文章头部可以填写：

```yaml
title: 文章标题
date: 2026-10-16 10:00:00
updated: 2026-10-16 10:00:00
categories:
  - 摄影
tags:
  - 长曝光
description: 一两句话说明文章内容，也作为列表摘要。
cover: /2026/10/16/文章标题/cover.jpg
```

图片放在同名资源目录中，正文可使用 `![说明](preview.jpg)` 引用。封面填写以 `/` 开头的站内公开路径。正文里显示的那张图建议单独准备一份（例如 1600px 长边的 `preview.jpg`），大图用普通链接挂在图上，例如 `[![说明](preview.jpg)](main.jpg)`——链接目标不会进入 `srcset`，所以不必为它准备变体。

站点时区为 `Asia/Shanghai`；未来日期的内容不会提前发布（`future: false`），日期写到明天就会「生成了但产物里没有」，排查时先看这个。修改文章时手动更新 `updated`，避免每次部署把旧文章误标为刚刚更新。

## 图片

照片是本站的主体，构建期由 `scripts/image-pipeline.js` 统一处理，**不需要手工导出多份尺寸**：只要把图放进文章资源目录，构建时会按 `480 / 960 / 1600`（超过 2560 的源图封顶 2560）生成 JPEG / WebP / AVIF 变体，写进产物目录（`public/` 与 `public-domain/` 都不提交进仓库），并把正文里的 `<img>` 改写成 `<picture>`：

- 浏览器支持 AVIF 就用 AVIF，其次 WebP，最后才回退 JPEG；
- `<source>` 带 `srcset` + `sizes`，手机不会去下 1600px 的图；
- `img` 上补了 `width` / `height`，避免图片加载完把正文顶下去（CLS）；
- 装饰性大图（首页 Hero、文章页头图）改为 `loading="eager"` + `fetchpriority="high"`——它们通常就是 LCP 元素，延后加载只会更慢；
- 主题自带的懒加载在这里被接管：`.lazy` 类与 `data-src` 会被去掉，改用原生 `loading="lazy"`。原因是 `<picture>` 的 `<source>` 一旦被浏览器选中，再改 `<img src>` 就没用了，两套机制会打架。

只处理「页面上真的用 `<img>` 显示出来」的图。正文里 `[![…](preview.jpg)](main.jpg)` 的链接目标（`main.jpg`）不生成变体——为一张 7008px 的原图编码 4K AVIF 是纯浪费。实测效果：正文图在手机上从 137KB 降到 9.4KB，列表页封面从 60KB 降到 4KB。

主题自带的图片预处理（`features.image_optimization`，默认开启）在 `_config.stellar.yml` 里被显式关掉了：它会在 `after_generate` 扫产物、用 sharp 算尺寸与平均色存进 `source/_data/caches/images_metadata.json`，遇到本站生成的变体路径会报「Local image route not found」并白跑一遍分析。尺寸与懒加载由上面的管线负责，两者同时开只会互相打架。

`source/` 里的**原图**不会被自动改动。想压小体积用：

```bash
bun run images:report     # 只报告：哪些图过大、能省多少
bun run images:compress   # 真正重压（长边 >3840 或 >1.5MB 的 JPEG）
```

现有那张 `main.jpg` 已经从 7008×4672 / 4.08MB 压到 3840×2560 / 0.44MB（省 90%），所以正文里的说法是「查看大图」而不是「查看原图」——真正未压缩的原始文件在 Git 历史里（`git log --follow -- source/_posts/hankou-river-beach/main.jpg`）。

## 无障碍

`scripts/a11y.js` 在构建期做五件事，都是实测产物发现的问题：

1. **每页恰好一个 `h1`**。主题在首页会同时输出两个：Hero 大标题和页面标题「欢迎来访」。规则是「保留第一个、其余降级为 `h2`」——首页保留 Hero 大标题，关于 / 订阅 / 组件示例这类只有页面标题的页面不受影响。降级不改外观：主题的标题样式挂在 `.title` 类上，与标签名无关（自检会核对降级后仍是 25px）。
2. **列表页补 `h1`**。`/posts/`、`/archives/`、`/categories/*`、`/tags/*` 原本一个 `h1` 都没有。这里按 canonical 路径推一个语义标题（如「标签：武汉」「2026 年 9 月归档」），插在 `<main>` 开头并用 clip 技巧做**视觉隐藏**——不是 `display:none`，那样会被无障碍树忽略，等于没加。
3. **图片补 `alt`**。卡片封面用同一张卡片里的文章标题；背景类图片（`class` 含 `bg`、位于 `aria-hidden` 容器内）与拿不到标题的一律 `alt=""`（明确表示装饰性，与「完全没有 `alt`」在无障碍树里是两回事）。
4. **viewport 去掉 `maximum-scale`**。主题在 `layout/_partial/head.ejs` 里写死了 `width=device-width, initial-scale=1, maximum-scale=1`，没有配置项。`maximum-scale=1` 会禁掉双指缩放（Android Chrome 直接生效），WCAG 1.4.4「调整文字大小」不达标——想放大看照片参数的人放不大。现在构建期删掉 `maximum-scale` / `minimum-scale` / `user-scalable` 三个 token，`width` 与 `initial-scale` 原样保留。
5. **补「跳到主要内容」链接**。主题不提供 skip link，键盘用户每次都要先走完顶栏和 Hero 的四个按钮才到正文（WCAG 2.4.1）。构建期在 `<body>` 之后插入页面里第一个可聚焦元素，指向 `<main id="main">`，并给 `main` 加 `tabindex="-1"`——不加的话部分浏览器只滚动、不移动焦点，屏幕阅读器仍停在原地。样式用「离屏直到聚焦」，不做 `display:none`。

后两条是 2026-10-17 复查时补的（前三条更早就有了）。`tools/check-site.mjs` 会守住：viewport 不含 `maximum-scale`、每页恰好一个指向 `#main` 的 skip link、`#main` 带 `tabindex="-1"`。

首页 Hero 的**对比度**是单独处理的，见 `_config.stellar.yml` 的 `inject.head_end`。主题只为视频 / 动效英雄加遮罩，图片英雄只有一层「底部渐隐到页面底色」，标题、简介和按钮直接压在照片上；无头 Chrome 实测修之前小字只有 2.56:1（WCAG AA 需要 4.5:1）。现在的做法是在模糊层与渐隐层之间插一层 `rgba(0,0,0,.30)` 遮罩，并把 Hero 文字一律钉成白色（用 `!important` 压过主题 adaptive-text 写在元素上的内联变量，否则换一张照片就可能翻到低对比度那一侧）。修完实测 6.27:1（主按钮反色后 21:1），浅色与深色外观都达标。

⚠️ 遮罩保证的是「当前这张照片」。换成天空占比更大、整体更亮的照片时同一层遮罩可能不够，务必重新量一次（见下）。

### 本地核对无障碍与 CSP

`tools/browser-check.mjs` 会用无头 Chrome 打开产物页面并回传实测数据：

```bash
bun run browser:a11y         # 浅色外观检查首页 / 列表页 / 组件示例页 / 关于页
bun run browser:a11y:dark    # 深色外观
node tools/browser-check.mjs --shot /tmp/page-{page}.png /   # 顺便存一张截图
```

它做的是纯文本自检做不到的事：把每段压在照片上的文字**先隐藏再截图**、取文字背后区域的平均亮度算真实对比度（标题是大字门槛 3:1，简介和按钮是小字门槛 4.5:1）；统计 `h1` 数量、缺 `alt` 的图、**裂图**（`naturalWidth === 0`）；并回报控制台错误与 **CSP 违规**。它会按 `_headers` 的规则起本地服务，所以能提前验证响应头会不会把站点自己的资源挡掉——MathJax 的公式字形来自 cdnjs，`font-src` 漏一个域名就是一堆豆腐块，这个脚本第一次跑就抓到了这个问题。它需要本机有 Chrome 和 sharp，属于本地工具，不进 CI。

**只量首屏之内的候选文字**（2026-10-17 修）。截图取的是视口，元素坐标落到视口外会被钳到边缘，量到的其实是照片底部那一行像素——首页的面包屑「主页」和「更新于」本来压的是页面底色，却因此被误报成 3.35:1「不足」。压在照片上的文字必然在首屏内（Hero 和文章 banner 都在顶部），跳过的部分会在输出里明确报数，不静默丢弃。

## 响应头与缓存

Cloudflare Pages 的 `_headers` 由 `scripts/cloudflare-headers.js` 在构建期写进产物根目录。**不能直接放 `source/_headers`**：Hexo 会忽略 `source/` 下以 `_` 开头的文件和目录，那个文件根本不会被复制进产物。

`/*` 上挂着安全头：`Strict-Transport-Security`（一年，含子域，暂不进 preload）、`Content-Security-Policy`、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`、`Cross-Origin-Resource-Policy`。CSP 里必须显式放行主题运行时按需加载的第三方来源：`gcore.jsdelivr.net`（mermaid / marked / vanilla-lazyload）、`unpkg.com`（swiper）、`cdnjs.cloudflare.com`（MathJax，含 `font-src`），以及拉取 GitHub 仓库信息的 `connect-src api.github.com`。CSP 目前含 `'unsafe-inline'`（主题有内联脚本与构建期注入的内联样式），它挡不住内联脚本注入，但仍能挡住「本站没有放行的外部来源」。

缓存策略给 CSS / JS / 图片一周的 `stale-while-revalidate`，`sitemap.xml` / `atom.xml` / `search.json` / `robots.txt` 一小时。这里有两条 Cloudflare 的规则在约束写法，别按直觉改：

1. **`*` 是贪婪通配，能跨 `/` 匹配**（官方文档：a splat will greedily match all characters），所以 `/*.jpg` 能覆盖到 `2026/09/13/<slug>/cover.jpg` 这种深层路径。
2. **同一个头命中多条规则时，值会用逗号拼在一起**。所以 `/*` 上**不能**再写 `Cache-Control`，否则会和 `/*.css` 之类的规则拼成 `public, max-age=0, …, public, max-age=86400, …` 这种语义不明的东西；HTML 用 Cloudflare Pages 的默认值（实测 `public, max-age=0, must-revalidate`，正是文档页想要的）。同理，各条缓存规则之间不能有交集，图标 JSON 用 `/js/icons/*`、搜索索引用精确路径，而不是 `/*.json`。
3. 一个项目最多 **100 条**规则（现在是 15 条），`tools/check-site.mjs` 会守住这几条约定。

**第二条通道（腾讯云 ECS + Nginx）不认 `_headers` 文件**，安全头是在 `deploy/server-setup.sh` 的 Nginx 模板里另写一遍的（`add_header`）。两处的 CSP 字符串必须逐字符相同，`tools/check-site.mjs` 会直接比对这两份，改一处忘了另一处就会构建失败。Nginx 那边还有两点不同：缓存用 `expires -1` / `expires 30d` 表达同一套意图；HSTS 是**故意没开**的（见脚本里的注释——等 HTTPS 稳定跑一段时间再加），所以大陆通道目前比 Cloudflare 通道少一条 HSTS。

## 验证与发布

```bash
bun run verify
```

此命令清理并构建站点，然后检查本地链接与资源、必要页面、规范链接、搜索索引、Atom、站点地图和版权协议。只检查已有生成结果时运行 `bun run check`。

自检里还有几组「配置了就必须生效」的硬约束，都是踩过坑之后加的：每页恰好一个 `h1`、每张图都有 `alt`、viewport 里不许有缩放锁、每页要有指向 `#main` 的 skip link、社交卡片图不能是站点头像、`<picture>` 必须带 `srcset` 与尺寸、`_headers` 的安全头与缓存规则齐全、`favicon.ico` / `apple-touch-icon.png` / `/examples/` 必须在产物里、站点地图不许有重复 URL 且带图的文章必须有图片记录。改这些地方时别把自检一起改松——它失败是有原因的。

```bash
bun run verify:domain     # 生成并验证 Cloudflare 上传目录 public-domain/
bun run check             # 只检查已有产物
bun run browser:a11y      # 无头 Chrome 实测对比度、裂图、CSP（本地工具）
```

Pull Request 会执行检查；合并到 `main` 后，GitHub Actions 会构建并发布到 Cloudflare Pages。Cloudflare 自动发布需要先添加仓库 Secret `CLOUDFLARE_API_TOKEN`，设置方法见 [域名部署说明](docs/domain-deployment.md)。检查通过后才会发布。`bun run deploy` 尚未配置 Hexo 部署适配器。

仓库还有第二条发布通道：`.github/workflows/deploy-server.yml` 用 rsync 把 `public-domain/` 同步到腾讯云 ECS（大陆主站，Nginx 直接托管静态文件）。它默认关闭，用仓库变量 `SERVER_DEPLOY=true` 打开；服务器初始化、备案与切解析顺序见 [大陆托管与备案](docs/mainland-hosting.md)。备案号填 `_config.yml` 的 `beian` 段，留空时页脚不输出任何内容。

## 常用修改位置

| 内容 | 文件 |
| --- | --- |
| 站点标题、URL、时区和订阅 | `_config.yml` |
| 顶部导航、外观、文章功能、页脚、head 注入 | `_config.stellar.yml` |
| 欢迎语和侧栏组件 | `source/_data/widgets.yml` |
| 关于与订阅说明 | `source/about/`、`source/subscribe/` |
| 首页大图、文档树、介绍和入口 | `source/_data/wiki/home.yml`、`source/index.md` |
| 公式 / 图表 / 时间线的验证页 | `source/examples/index.md` |
| 订阅正文的相对资源路径与版权 | `templates/atom.xml` |
| 响应式图片与变体生成 | `scripts/image-pipeline.js` |
| 站点地图的 URL 与图片/归档补全 | `templates/sitemap.xml`、`scripts/sitemap-extras.js` |
| 安全响应头与缓存策略 | `scripts/cloudflare-headers.js` |
| `h1` / `alt` / skip link 等无障碍修正 | `scripts/a11y.js` |
| 图标文件生成 | `tools/make-favicon.mjs` |
| 产物自检的硬约束 | `tools/check-site.mjs` |
| 对比度 / 裂图 / CSP 实测 | `tools/browser-check.mjs` |

## 关于专栏与笔记本

2026-10-17 起站点只保留摄影内容，`topic`（专栏）与 `notebooks`（笔记本）两套栏目连同 `source/_data/topic*.yml`、`source/_data/notebooks/`、`source/notebooks/` 一起移除，顶栏菜单、页脚入口和自检里的必查页面同步删掉。

主题本身仍然支持这两套集合，需要时按 [Stellar 官方文档](https://xaoxuu.com/wiki/stellar/) 重新加回配置即可；被删掉的定义文件在 Git 历史里能找到。

图标名要用主题图标集里的真实名称，可用名称见构建产物 `public/js/icons/default.json`。

正式入口为 `https://blog.guangluo.top/`，所有构建都使用根路径。旧 GitHub Pages 发布任务已移除，GitHub 继续保存源码并运行检查与 Cloudflare 自动发布。

`bun run verify:domain` 生成并验证 Cloudflare 上传目录 `public-domain/`；`bun run server:domain` 在 `http://localhost:4001/` 预览。`_config.domain.yml` 仅指定输出目录。域名、SEO 地址和内链不再需要兼容脚本转换。当前接入状态见 [域名部署说明](docs/domain-deployment.md)。

评论、访问统计和邮件订阅未接入外部服务。若需要评论，先配置自己的 Giscus / Waline 等服务；当前 GitHub 仓库未开启 Issues 或 Discussions。不要直接启用主题示例中的服务地址。

主题固定为 Stellar `2.0.0`，导航、搜索、外观切换和 SEO 使用 v2 原生配置。站点整体采用与 [Stellar 官方文档站](https://xaoxuu.com/wiki/stellar/) 一致的外观：`minimal` 外观预设、`card_hover` 高亮与滚动显现动画。主菜单和站内搜索位于顶部栏，左侧栏在首页、关于和订阅页显示文档树，右侧栏显示仓库卡片与本文目录。文章列表位于 `/posts/`。

首页与 `source/about/`、`source/subscribe/` 组成名为 `home` 的 Wiki 集合（`source/_data/wiki/home.yml`）：这三个页面用 `collection` 声明 `profile: wiki`，`navigation.tree` 决定左栏文档树的章节与顺序。文档树条目是相对站点根的源路径，例如 `/index.html`、`about/`、`subscribe/`；集合的 `route.path` 为 `/`，主题会去掉前缀斜杠后再拼接，因此这三条键分别解析为 `/`、`about`、`subscribe`。首页 `permalink: /` 保证根目录输出。

## 公式、图表与时间线

三者用法见 `/examples/`（`source/examples/index.md`），那也是它们的验证页；示例内容按摄影主题写（互易律、超焦距、拍摄流程），既当测试页也当随手备忘。这一页在 2026-10-17 曾随「只留摄影内容」一起被删掉，后来发现 `scripts/math-protect.js` 与 `scripts/mermaid-blocks.js` 就没了任何页面在用，于是从 Git 历史恢复并改写；`tools/check-site.mjs` 现在把 `examples/index.html` 列为必查页面，免得再次出现「脚本还在、页面没了」。

写这一页时踩到一个坑：`date` 写成了当天中午，而当时是清晨，`future: false` 直接让它不生成——页面文件在 `source/` 里却不出现在产物中，先查日期。

**公式**用 `$...$` 行内、`$$...$$` 行间。`hexo-renderer-marked` 会破坏 LaTeX，所以由 `scripts/math-protect.js` 在构建期处理：把公式里的 `\,` `\;` `\:` `\!`（CommonMark 的可转义标点，会被吃掉）换成数学模式等价的 `\mkern{3,5,4,-3}mu`，把 `$$` 块先抽成占位标记避免被拆行，渲染后再还原。MathJax 由插件按页注入，只有含公式的页面才加载。

`features.math.provider` **必须保持 `null`**——主题自带的客户端扩展只认 `<script type="math/tex">`（MathJax 2 的约定），在 MathJax 3 下不会排版。

改 `scripts/math-protect.js` 里的 MathJax 配置字符串后，**务必检查产物结构**：`grep -c '</html>' public/<page>/index.html` 必须为 `1`。早期版本把配置写成多行、并在单引号数组字面量里直接写 `$`，会让整页外壳重复三次并产生 EJS 残留；改为当前的单行双引号转义写法后正常。

**图表**用 `mermaid` 语言的代码块。主题的 diagrams 扩展靠 `.mermaid` 选择器激活，而 marked 会把代码块输出成普通高亮块，所以 `scripts/mermaid-blocks.js` 在构建期把围栏换成 `<pre class="mermaid">`。官方文档建议装 `hexo-filter-mermaid-diagrams`，这里用等价本地实现，避免引入该包（最后更新于 2022 年，依赖已废弃的 `deep-assign`）。

**时间线**用主题内置的 `{% timeline %}` 标签，无需配置，节点写在 `<!-- node 标题 -->` 之间。

## SEO 与分享

依据[官方 SEO 指南](https://xaoxuu.com/wiki/stellar/guides/seo/)配置，站点已有：页面标题与描述、canonical、Open Graph / Twitter 卡片、JSON-LD 结构化数据、`sitemap.xml` 与 `robots.txt`、Atom 自动发现。

| 配置 | 位置 | 说明 |
| --- | --- | --- |
| 站点地址与描述 | `_config.yml` 的 `url` / `description` / `keywords` | canonical 与所有绝对地址的基础 |
| 主站主机 | `_config.stellar.yml` 的 `canonical.host` | 必须是裸主机名 |
| 备用主机 | `canonical.allowed_hosts` | 见下 |
| 社交卡片 | `open_graph.enabled` | 已显式开启（主题默认也是开） |
| 作者外部资料 | `structured_data.same_as` | 进入 JSON-LD 的 `sameAs` |
| 默认封面 | `fallbacks.cover` | `source/images/cover.jpg`，1200×630 |

**主题的「非法克隆站 / 官方备用站」浮层已整体关掉**，见下文的 `scripts/canonical-notice.js`。`canonical.host` 仍必须填主站裸主机名，它决定页面的 `<link rel="canonical">`；`allowed_hosts` 目前只是记录（本站同时从 `blog.guangluo.top`、Cloudflare Pages 域名、裸域 / www 和大陆 ECS 的 IP 提供服务，逐个列出来便于日后恢复提示）。

`scripts/seo-fixes.js` 修了三处主题行为，都是实测产物发现的：

1. **结构化数据的图片是相对路径**。主题把作者的 `authorImage` 绝对化了，但文章 `image` 直接用 `postImages()` 的返回值，输出成 `/images/cover.jpg`。schema.org 要求绝对 URL，Google 富媒体测试会报错。插件用 canonical 的 origin 补齐（404 页没有 canonical，退回 `_config.yml` 的 `url`）。
2. **没有封面的页面 `og:image` / `twitter:image` 用的是站点头像**。主题的兜底顺序是 `pageConfig.cover || 正文首图 || config.avatar`，所以首页、关于、订阅、404 这些页面在社交平台和 IM 里都是一张 280×280 的方头像。现在只要图片落在头像上就换成 `fallbacks.cover`（1200×630）；文章自己的封面和正文首图不受影响。
3. **`twitter:card` 统一成 `summary_large_image`**。主题只在「文章 + 有封面」时才用大卡片，图片修好之后所有页面都有合格的大图，小卡片反而不合适。

自检会守住结果：每页都要有绝对地址的 `og:image`、不能等于站点头像、`twitter:card` 必须是 `summary_large_image`。

另外，主题默认的 `fallbacks.cover` / `link_card` 指向**主题作者 CDN 的占位图**（`gcore.jsdelivr.net/gh/cdn-x/placeholder`）。本站已把 `cover` 换成自己的图；`link_card` 未配置，因为站点目前没有用到链接卡片类标签。自检会检查页面里不再出现该 CDN。

`scripts/canonical-notice.js` **关掉了主题的「非法克隆站 / 官方备用站」浮层**。主题的 `canonicalCheck` 在「当前主机 ≠ 主站主机」时会盖一层浮层：主机在 `allowed_hosts` 里就提示「本站为官方备用站，仅供应急」，否则提示「本站为非法克隆站」，两种情况都会顺手往 `<head>` 插一个 `noindex, nofollow`。本站有 5 个入口（主站、Pages 域名、裸域、www、大陆 IP），那层提示在任何备用入口都会出现，因此整体关闭。

主题没有开关，而判定要求「当前主机 == canonical 主机」才静默，纯静态配置做不到，所以改用构建期注入：在主题 `main.js`（defer）执行**之前**清掉客户端判定数据里的 `host` / `encoded`，`canonicalCheck` 的第一行 `if (!getOriginalHost()) return` 就直接返回。页面里的 `<link rel="canonical">` 仍指向主站，不受影响。自检会要求每个页面都带上那段内联脚本；**想恢复提示就删掉这个文件**。

### 抓取策略（robots.txt）

`source/robots.txt` 是**默认拒绝**：`User-agent: *` 落 `Disallow: /`，只显式放行下面这些例外。分组按 robots.txt 的最长匹配生效，命中了具名组的爬虫走自己的规则，其余全部落到 `*`。

| 分区 | 放行对象 |
| --- | --- |
| 搜索引擎 | Googlebot、Bingbot、Baiduspider、Sogou web spider、360Spider / HaosouSpider、YisouSpider、Applebot、DuckDuckBot、YandexBot、Slurp、MojeekBot、Qwantify、SeznamBot、Yeti、Brave |
| AI 搜索 / 用户触发抓取 | OAI-SearchBot、ChatGPT-User、Claude-SearchBot、Claude-User、PerplexityBot、Perplexity-User、meta-externalfetcher |
| 社交链接预览 | Twitterbot、facebookexternalhit / Facebot、TelegramBot、Discordbot、Slackbot、WhatsApp、LinkedInBot、Pinterestbot、redditbot、Embedly、SkypeUriPreview、cardyb |
| RSS 阅读器 | Feedly、Inoreader、NewsBlur、Feedbin、BazQux Reader、The Old Reader、Miniflux、FreshRSS、Tiny Tiny RSS、NetNewsWire、Reeder、newsboat、Akregator、Feedspot |
| 网页存档 | ia_archiver、archive.org_bot |

**AI 分两类处理**（2026-10-17 调整）：AI 搜索与用户触发抓取放行——它们要么在为 AI 搜索建索引，要么是用户当下问到了本站、按需取一页，结果是回答里带引用、带来引荐流量；AI 训练与数据采集（GPTBot、ClaudeBot、CCBot、Bytespider、Amazonbot、meta-externalagent、cohere-ai 等）和 SEO 工具（AhrefsBot、SemrushBot、MJ12bot、DotBot 等）仍显式写 `Disallow: /`。也就是「可以引用我，不要拿去训练」。`Google-Extended`、`Applebot-Extended` 不是爬虫，是关闭对应 AI 训练用途的开关，拒绝它们不影响 Googlebot / Applebot 的搜索抓取。

两点必须知道：

1. **robots.txt 只是约定**。不遵守它的采集器照样抓取，要真正拦住得在 Cloudflare 侧开 AI Crawl Control 或加 WAF 规则；反过来说，训练类爬虫的 `Disallow` 也只是表态，Cloudflare 侧不开规则就拦不住。
2. **自建 RSS 阅读器可能用自己的 UA**，会落到默认的 `Disallow: /`。遇到订阅失败，在阅读器分区补一行它的 UA 即可。

`tools/check-site.mjs` 会自检策略没被改跑偏：`User-agent: *` 必须是 `Disallow: /`，Googlebot / Bingbot / Baiduspider 必须 `Allow: /`，上表 AI 搜索那 7 个 UA 必须 `Allow: /`，GPTBot / ClaudeBot / CCBot / Bytespider / Google-Extended / Applebot-Extended / meta-externalagent 必须 `Disallow: /`。

### 搜索引擎收录

2026-10-17 实测：站点首次发布次日，Google 与百度都还没收录；搜狗、360、Bing、Brave 和站长工具查询同样是 0 条。抓取侧没有问题（`robots.txt` 对搜索引擎放行、`sitemap.xml` 有全部页面、Googlebot 和 Baiduspider 的 UA 都拿到 200），缺的是**主动提交**。仓库已经把提交做成配置项：

| 配置 | 位置 | 说明 |
| --- | --- | --- |
| 站长平台验证令牌 | `_config.yml` 的 `seo.verification` | `google` / `bing`，填了才输出对应 meta |
| IndexNow 密钥 | `seo.indexnow_key` | 构建时生成站点根目录的 `<key>.txt`，Bing / Yandex / Seznam / Naver 免登录核验 |

2026-10-17 复查：**别用脚本抓 Bing 搜索结果页来判断收录**。`https://www.bing.com/search?q=…` 对脚本客户端照样返回 200 和完整 HTML，但只有 `github`、`百度` 这类超热门查询给真实结果；`site:blog.guangluo.top`、`汉口江滩长曝光` 这类查询返回的是随机无关内容（同一个 `site:` 查询三次分别给出 Steam 论坛、DeepSeek 官网和漫画站），「结果数」也在 83 / 144,000 / 243,000 之间乱跳。补 Cookie 会话、`mkt=zh-CN&cc=CN`、`format=rss`、`cn.bing.com` 都试过，行为一致，属 Bing 对无浏览器会话客户端的降级响应。抓取侧则一切正常：用 bingbot 的 UA 请求首页、`sitemap.xml`、`atom.xml` 和文章页都是 200。所以 SERP 抓取只能说明「HTML 抓得到」，不能当作收录证据；要确认收录得登录 Bing Webmaster Tools 做 URL 检查，或填上 `seo.verification.bing` 后走官方 API。

`templates/sitemap.xml` 覆盖了 hexo-generator-sitemap 的默认模板：默认模板会让首页出现两次（posts 循环一次、末尾又硬编码一次），IndexNow 会把同一条 URL 提交两遍，`tools/check-site.mjs` 现在会拦住重复 URL。

站点地图由两半拼起来（2026-10-17 扩写）：

| 部分 | 位置 | 负责的内容 |
| --- | --- | --- |
| 模板 | `templates/sitemap.xml` | 文章、首页、标签、分类，以及 `xmlns:image` 命名空间 |
| 构建期脚本 | `scripts/sitemap-extras.js` | 每篇文章的 `<image:image>`、`/posts/` 与 `/archives/`、年月归档 |

为什么要分成两半：nunjucks 模板只能拿到 generator 传进去的 `posts` / `tags` / `categories`，而图片清单要从正文里现取、归档页根本不是 post 或 page，模板里都写不出来。脚本挂在 `after_generate` 上改写 `sitemap.xml` 这条路由，先查 `hexo.route.list()` 再决定收不收，所以不会出现「模板里写了、产物里没有」的 404 条目。自检会逐条校验 `<loc>` 与 `<image:loc>` 都能在产物里找到实体，并且**带图的文章必须有图片记录**。

收录口径：收文章、首页、`/posts/`、`/archives/` 与年月归档、分类页、标签页、独立页面；**不收分页**（`/posts/page/2/`）——同一批文章在分页里重复出现，`page/1` 与 `/posts/` 还是同一份内容，收进来只浪费抓取配额。

2026-10-17 实测推送：`node tools/ping-search.mjs _config.domain.yml --strict` 向 `api.indexnow.org` 提交站点地图里的 URL（条数随内容变化，别写死），返回 200。`<image:loc>` 不会被当成页面 URL 推给 IndexNow（`tools/ping-search.mjs` 用的是 cheerio 的 `loc` 选择器，`image:loc` 不在其中）。

百度搜索资源平台暂不接入：域名未备案，提交收录意义不大。备案后再补 `baidu-site-verification` 验证 meta、「普通收录」推送和 `robots.txt` 里的 Baiduspider 分组（分组已保留，因为百度仍可能自己抓取）。

```bash
bun run seo:ping:dry   # 只打印将要推送的 URL
bun run seo:ping       # 推送 IndexNow
```

`scripts/seo-indexing.js` 负责验证 meta 与密钥文件，`tools/ping-search.mjs` 负责发布后推送，`tools/check-site.mjs` 会检查「配置了就必须生效」。`.github/workflows/deploy-cloudflare.yml` 在 Pages 发布成功后自动执行推送，第三方接口失败只告警，不会把成功的发布判成失败。完整步骤见 [域名部署说明](docs/domain-deployment.md#搜索引擎收录)。

## 脚本与注入

`scripts/` 下的构建期插件只在生成静态文件时运行，不会发给访客：

| 脚本 | 作用 |
| --- | --- |
| `math-protect.js` / `mermaid-blocks.js` | 公式与图表的构建期处理（见上一节） |
| `image-pipeline.js` | 生成图片变体、把 `<img>` 改写成 `<picture>`（见 [图片](#图片)） |
| `a11y.js` | `h1` 归一、列表页补标题、图片补 `alt`、viewport 去缩放锁、补 skip link（见 [无障碍](#无障碍)） |
| `cloudflare-headers.js` | 生成 `_headers`（见 [响应头与缓存](#响应头与缓存)） |
| `seo-fixes.js` / `seo-indexing.js` | 修正结构化数据与社交卡片；输出站长平台验证 meta 与 IndexNow 密钥文件 |
| `beian.js` | 备案号页脚，留空时完全不输出 |
| `canonical-notice.js` | 关掉主题的「非法克隆站 / 官方备用站」浮层 |
| `lazy-images.js` | 给已经有真实 `src` 的图补原生 `loading` / `decoding` |
| `sitemap-extras.js` | 图片 sitemap 与 `/posts/`、归档页补进 `sitemap.xml`（见 [搜索引擎收录](#搜索引擎收录)） |

`_config.stellar.yml` 的 `inject.head_end` 负责两件事：图标链接（`favicon.ico` 与 `apple-touch-icon.png`）和首页 Hero 的对比度修正。

Hero 这段是**纠错后重写的**，值得记一笔：README 原先声称「图片英雄没有遮罩、已通过 `inject.head_end` 补到 3.4:1 / 5.1:1」，但 `git log -S 'inject:' -- _config.stellar.yml` 显示这个配置**从来没有存在过**，它引用的选择器 `.wiki-cover-background-overlay` 在 Stellar 2.0 的图片英雄里也已改写成「底部渐隐到底色」的纯渐变。也就是说这条「已修复」是假的。2026-10-17 用无头 Chrome 重新实测：小字（简介、导航、按钮）2.56:1，大标题 3.6:1。真正修好后的数字是全部 6.27:1（主按钮反色后 21:1），做法是在模糊层与渐隐层之间插一层 `rgba(0,0,0,.30)` 伪元素遮罩，并把 Hero 文字用 `!important` 一律钉成白色。改完记得用 `bun run browser:a11y` 复量。

`tools/check-site.mjs` 与 `tools/browser-check.mjs` 都只在本地/CI 检查产物，不会发给访客。主题自身仍会加载其 CSS 和 JavaScript。当前沿用主题默认 viewport 设置，包括 `maximum-scale=1`，没有额外改写主题输出。

`verify` 和 `verify:domain` 都会先执行 `hexo stellar doctor`，再构建并检查站点。迁移参考：[官方 v2 迁移指南](https://xaoxuu.com/wiki/stellar/migration/v1-to-v2/)、[原生 Hero 配置](https://xaoxuu.com/wiki/stellar/guides/wiki/)。

## 技术栈

- [Hexo](https://hexo.io/)：静态博客生成器
- [Stellar](https://github.com/xaoxuu/hexo-theme-stellar)：博客主题
- [Bun](https://bun.sh/)：JavaScript 运行时和包管理器
- [sharp](https://sharp.pixelplumbing.com/)：构建期的图片编码（主题本来就用它，这里是显式声明为 devDependency）
- Cloudflare Pages：静态网站托管与自动发布

## 许可证

文章、图片和配置文件均以 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可发布，详情见 [LICENSE](LICENSE)。转载或改编时请注明作者罗广，并附上许可证链接。

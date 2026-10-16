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
- 站点地图、robots.txt、规范链接、主题自带的 Open Graph 与结构化数据。
- 搜索引擎收录支持：站长平台验证 meta、IndexNow 密钥文件、发布后自动推送（见 [SEO 与分享](#seo-与分享)）。
- 本地图标与 404 插图；照片提供封面、正文预览图和原图入口。
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

图片放在同名资源目录中，正文可使用 `![说明](preview.jpg)` 引用。封面填写以 `/` 开头的站内公开路径。图片较大时建议单独准备预览图，原图可通过普通链接提供。现有摄影文章保留了 `main.jpg` 原图。

站点时区为 `Asia/Shanghai`；未来日期的内容不会提前发布。修改文章时手动更新 `updated`，避免每次部署把旧文章误标为刚刚更新。

## 验证与发布

```bash
bun run verify
```

此命令清理并构建站点，然后检查本地链接与资源、必要页面、规范链接、搜索索引、Atom、站点地图和版权协议。只检查已有生成结果时运行 `bun run check`。

Pull Request 会执行检查；合并到 `main` 后，GitHub Actions 会构建并发布到 Cloudflare Pages。Cloudflare 自动发布需要先添加仓库 Secret `CLOUDFLARE_API_TOKEN`，设置方法见 [域名部署说明](docs/domain-deployment.md)。检查通过后才会发布。`bun run deploy` 尚未配置 Hexo 部署适配器。

仓库还有第二条发布通道：`.github/workflows/deploy-server.yml` 用 rsync 把 `public-domain/` 同步到腾讯云 ECS（大陆主站，Nginx 直接托管静态文件）。它默认关闭，用仓库变量 `SERVER_DEPLOY=true` 打开；服务器初始化、备案与切解析顺序见 [大陆托管与备案](docs/mainland-hosting.md)。备案号填 `_config.yml` 的 `beian` 段，留空时页脚不输出任何内容。

## 常用修改位置

| 内容 | 文件 |
| --- | --- |
| 站点标题、URL、时区和订阅 | `_config.yml` |
| 顶部导航、外观、文章功能和页脚 | `_config.stellar.yml` |
| 欢迎语和侧栏组件 | `source/_data/widgets.yml` |
| 关于与订阅说明 | `source/about/`、`source/subscribe/` |
| 首页大图、文档树、介绍和入口 | `source/_data/wiki/home.yml`、`source/index.md` |
| 订阅正文的相对资源路径与版权 | `templates/atom.xml` |

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

三者用法见 `/examples/`（`source/examples/index.md`），那也是它们的验证页。

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

`scripts/seo-fixes.js` 修了两处主题行为，都是实测产物发现的：

1. **结构化数据的图片是相对路径**。主题把作者的 `authorImage` 绝对化了，但文章 `image` 直接用 `postImages()` 的返回值，输出成 `/images/cover.jpg`。schema.org 要求绝对 URL，Google 富媒体测试会报错。插件用 canonical 的 origin 补齐。
2. **文章没有封面时 `og:image` 用的是头像一个 1:1 的图**，而不是 `fallbacks.cover`。社交平台对 1200×630 的卡片更友好，因此无封面的文章改用默认封面。

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

`templates/sitemap.xml` 覆盖了 hexo-generator-sitemap 的默认模板：默认模板会让首页出现两次（posts 循环一次、末尾又硬编码一次），IndexNow 会把同一条 URL 提交两遍，`tools/check-site.mjs` 现在会拦住重复 URL。2026-10-17 实测推送：`node tools/ping-search.mjs _config.domain.yml --strict` 向 `api.indexnow.org` 提交 8 条 URL，返回 200。

百度搜索资源平台暂不接入：域名未备案，提交收录意义不大。备案后再补 `baidu-site-verification` 验证 meta、「普通收录」推送和 `robots.txt` 里的 Baiduspider 分组（分组已保留，因为百度仍可能自己抓取）。

```bash
bun run seo:ping:dry   # 只打印将要推送的 URL
bun run seo:ping       # 推送 IndexNow
```

`scripts/seo-indexing.js` 负责验证 meta 与密钥文件，`tools/ping-search.mjs` 负责发布后推送，`tools/check-site.mjs` 会检查「配置了就必须生效」。`.github/workflows/deploy-cloudflare.yml` 在 Pages 发布成功后自动执行推送，第三方接口失败只告警，不会把成功的发布判成失败。完整步骤见 [域名部署说明](docs/domain-deployment.md#搜索引擎收录)。

## 脚本与注入

`scripts/` 下两个构建期插件（公式、图表）都只在生成静态文件时运行，不会发给访客。`scripts/seo-fixes.js` 修正结构化数据与社交卡片，`scripts/seo-indexing.js` 只输出站长平台验证 meta 和 IndexNow 密钥文件；两者都不改变抓取结果以外的行为。唯一的样式注入是 `_config.stellar.yml` 里的 `inject.head_end`：它给首页 Hero 的**图片**背景补一层轻遮罩。主题只为「视频 / 动效」英雄加遮罩，图片英雄不加，而汉口江滩这张照片的天空很亮，白色标题在浅色和深色下的对比度都只有 2.2:1；补遮罩后标题为 3.4:1、简介为 5.1:1，达到 WCAG AA。选择器沿用主题原始的 `.cover-content.wiki-hero .wiki-cover-background.image .wiki-cover-background-overlay` 以覆盖默认值，作用范围只限首页图片英雄。

`tools/check-site.mjs` 仅在构建时检查生成结果，不会发给访客。主题自身仍会加载其 CSS 和 JavaScript。当前沿用主题默认 viewport 设置，包括 `maximum-scale=1`，没有额外改写主题输出。

`verify` 和 `verify:domain` 都会先执行 `hexo stellar doctor`，再构建并检查站点。迁移参考：[官方 v2 迁移指南](https://xaoxuu.com/wiki/stellar/migration/v1-to-v2/)、[原生 Hero 配置](https://xaoxuu.com/wiki/stellar/guides/wiki/)。

## 技术栈

- [Hexo](https://hexo.io/)：静态博客生成器
- [Stellar](https://github.com/xaoxuu/hexo-theme-stellar)：博客主题
- [Bun](https://bun.sh/)：JavaScript 运行时和包管理器
- Cloudflare Pages：静态网站托管与自动发布

## 许可证

文章、图片和配置文件均以 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可发布，详情见 [LICENSE](LICENSE)。转载或改编时请注明作者罗广，并附上许可证链接。

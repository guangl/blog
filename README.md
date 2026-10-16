# guangluo's blog

基于 [Hexo](https://hexo.io/) 和 [Stellar](https://github.com/xaoxuu/hexo-theme-stellar) 的个人博客，使用中文记录一名 DBA 的数据库管理、运维经验与摄影随记。

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

启动后访问 <http://localhost:4000/blog/>。

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
- 浅色 / 深色 / 跟随系统三种外观；键盘焦点、跳到正文与减少动画支持。
- 全文 Atom 订阅：<https://guangl.github.io/blog/atom.xml>。
- 站点地图、robots.txt、规范链接、主题自带的 Open Graph 与结构化数据。
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
  - 数据库
tags:
  - PostgreSQL
description: 一两句话说明文章内容，也作为列表摘要。
cover: /blog/2026/10/16/文章标题/cover.jpg
```

图片放在同名资源目录中，正文可使用 `![说明](preview.jpg)` 引用。封面需要填写带 `/blog/` 的公开路径。图片较大时建议单独准备预览图，原图可通过普通链接提供。现有摄影文章保留了 `main.jpg` 原图。

站点时区为 `Asia/Shanghai`；未来日期的内容不会提前发布。修改文章时手动更新 `updated`，避免每次部署把旧文章误标为刚刚更新。

### DBA 实践文章

```bash
bunx hexo new dba "文章标题"
```

使用 `scaffolds/dba.md` 创建文章，按普通文章布局展示，默认归入「数据库运维」。模板包括结论、环境与版本、问题现象、排查过程、处理步骤、验证结果、回退方案和总结参考。写作提示放在 Markdown 注释里，不会显示在网页正文中。

新文章会写入 `source/_posts/`，填写真实案例后再随站点发布。按实际内容调整分类、标签、摘要和小节；摄影与生活随记继续使用普通的 `post` 模板。

## 验证与发布

```bash
bun run verify
```

此命令清理并构建站点，然后检查本地链接与资源、必要页面、规范链接、搜索索引、Atom、站点地图和版权协议。只检查已有生成结果时运行 `bun run check`。

Pull Request 会执行检查；推送 `main` 后，GitHub Actions 会分别构建 GitHub Pages 和 Cloudflare Pages。Cloudflare 自动发布需要先添加仓库 Secret `CLOUDFLARE_API_TOKEN`，设置方法见 [域名部署说明](docs/domain-deployment.md)。检查通过后才会发布。`bun run deploy` 尚未配置 Hexo 部署适配器。

## 常用修改位置

| 内容 | 文件 |
| --- | --- |
| 站点标题、URL、时区和订阅 | `_config.yml` |
| 菜单、外观、文章功能和页脚 | `_config.stellar.yml` |
| 欢迎语和侧栏组件 | `source/_data/widgets.yml` |
| 关于与订阅说明 | `source/about/`、`source/subscribe/` |
| 样式与交互 | `source/css/custom.css`、`source/js/custom.js` |
| 规范链接、首页介绍和主题补充 | `scripts/site.js` |
| 订阅正文的相对资源路径与版权 | `templates/atom.xml` |
| DBA 实践文章模板 | `scaffolds/dba.md` |

本站部署在 `/blog/` 子路径，迁移域名或路径时需要同时更新配置、正文内链、注入资源地址和 `source/robots.txt`，再运行完整验证。

已为 `https://blog.guangluo.top/` 准备单独的 `_config.domain.yml`：运行 `bun run verify:domain` 生成并验证 `public-domain/`，或用 `bun run server:domain` 在 `http://localhost:4001/` 预览。运行 `bun run deploy:domain` 会先检查，再部署到 Cloudflare Pages 项目 `guangluo-blog`（需要先完成 Wrangler 登录）。此构建会适配旧站路径与 SEO 地址，不改变默认 GitHub Pages 构建。当前接入状态和 DNS 设置见 [域名部署说明](docs/domain-deployment.md)。

评论、访问统计和邮件订阅未接入外部服务。若需要评论，先配置自己的 Giscus / Waline 等服务；当前 GitHub 仓库未开启 Issues 或 Discussions。不要直接启用主题示例中的服务地址。

## 技术栈

- [Hexo](https://hexo.io/)：静态博客生成器
- [Stellar](https://github.com/xaoxuu/hexo-theme-stellar)：博客主题
- [Bun](https://bun.sh/)：JavaScript 运行时和包管理器
- GitHub Pages：静态网站托管

## 许可证

文章、图片和配置文件均以 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可发布，详情见 [LICENSE](LICENSE)。转载或改编时请注明作者 Guang Luo，并附上许可证链接。

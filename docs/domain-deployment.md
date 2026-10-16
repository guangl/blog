# blog.guangluo.top 接入

目标：使用 Cloudflare Pages 托管静态博客，并使用现有 Cloudflare DNS，访问地址为 `https://blog.guangluo.top/`。不接入腾讯云。

## 当前状态

- `guangluo.top` 的权威 DNS 已是 Cloudflare：`elias.ns.cloudflare.com`、`etta.ns.cloudflare.com`。
- 2026-10-16 已创建 Pages 项目 `guangluo-blog`，生产部署状态为 `success`，上传 84 个静态文件。
- Pages 地址：`https://guangluo-blog.pages.dev/`；自定义域名：`https://blog.guangluo.top/`。
- 2026-10-16 Cloudflare API 已确认 `blog.guangluo.top` 的域名状态、DNS 验证和证书验证均为 `active`。
- 已配置 GitHub 仓库 Secret 并启用自动发布，[首次 GitHub Actions 发布](https://github.com/guangl/blog/actions/runs/38893301306)已成功，构建和站点检查均通过。
- 域名暂未备案，使用 Cloudflare 的全球网络；大陆直连效果需要上线后实测。
- 当前授权可部署 Pages、绑定域名和读取区域信息，不含 DNS 修改权限。DNS 记录由域名所有者在控制台添加。
- Pages API 和 GitHub Actions 均确认部署成功；大陆访问表现需结合实际运营商网络测试。

## 本地构建与验证

```bash
bun install --frozen-lockfile
bun run verify:domain
```

产物在 `public-domain/`，包括使用新域名的 canonical、Open Graph、结构化数据、订阅源和站点地图，以及根目录的 `robots.txt`。站点配置、内链与图片路径已统一使用正式域名和根路径。

预览新站：

```bash
bun run server:domain
```

访问 `http://localhost:4001/`。默认构建也使用相同域名与根路径，仅输出目录不同。

## 后续发布

自动发布工作流为 `.github/workflows/deploy-cloudflare.yml`。配置仓库凭据并将该文件推送到 `main` 后，每次提交到 `main` 都会构建、检查并发布到 Cloudflare Pages 项目 `guangluo-blog`。也可以在 GitHub Actions 中选择 **Deploy to Cloudflare Pages → Run workflow**，仅允许从 `main` 发布到生产站点。

首次接入需要：

1. 在 Cloudflare 创建自定义 API Token，权限仅选择 **Account → Cloudflare Pages → Edit**，资源限定为博客所在账户。
2. 在 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret** 添加 `CLOUDFLARE_API_TOKEN`，值为刚创建的 Token。账户 ID 已配置在工作流中，不需要额外添加。
3. 推送 `main`，在 Actions 检查发布结果。工作流会先检查页面、资源、内链、搜索、订阅、站点地图和 SEO 信息，检查通过才上传 `public-domain/`。构建失败时不会发布。

Token 只放在 GitHub Secret，不提交到仓库。当前本机 Wrangler 的 OAuth 登录用于本地发布，不能替代 GitHub Actions 的部署 Token。

平时修改文章后，在功能分支提交并创建 Pull Request。检查通过并确认合并到 `main` 后，Cloudflare 自动发布新版本。源码和检查仍在 GitHub；旧 GitHub Pages 发布任务已移除，旧地址不再自动更新。

本机手动发布仍可作为备用方式：

```bash
bun run deploy:domain
```

命令会先执行主题 Doctor、重新构建并检查，再将 `public-domain/` 上传到已有的 `guangluo-blog` 项目。Stellar 已升级并固定为 `2.0.0`，配置与页面字段已迁移。正式域名与根路径统一在 `_config.yml` 配置，`_config.domain.yml` 仅指定上传目录。首页使用原生 Wiki Hero，没有自定义 JS、CSS 或路径适配脚本。

## 手动上传备用方式

1. 在 Cloudflare 控制台进入「Workers 和 Pages」，创建 Pages 项目。
2. 选择 Direct Upload，上传 `public-domain/` 中的静态产物，或者上传该目录内容打包得到的 ZIP（压缩包根目录应直接包含 `index.html`）。不要上传源码、`node_modules/` 或仓库配置。
3. 部署成功后，在项目的 Custom domains 中添加 `blog.guangluo.top`。
4. 按控制台提示确认 DNS 记录，等待域名激活和 HTTPS 证书签发。

Direct Upload 项目后续可使用 Wrangler 和 GitHub Actions 自动部署。Cloudflare 不支持把该项目直接切换成原生 Git 集成模式；如果希望使用原生 Git 集成，应在创建时选择连接 GitHub 仓库。Git 集成的安装命令为 `bun install --frozen-lockfile`，构建命令为 `bun run verify:domain`，输出目录为 `public-domain`，运行环境需满足 Node.js 22+ 和 Bun 1.4.3。

## Cloudflare DNS 设置

先在 Pages 项目里绑定自定义域名，再由控制台添加对应 CNAME。不能只添加 DNS 记录而不做 Pages 域名绑定。

| 字段 | 值 |
| --- | --- |
| 类型 | CNAME |
| 名称 | blog |
| 目标 | `guangluo-blog.pages.dev` |
| 代理 | Proxied（橙云） |
| TTL | Auto |

该区域已在 Cloudflare DNS 托管时，Pages 自定义域名流程可添加所需记录。只改本次博客对应的记录，保留现有根域、www、邮件等记录。

## 上线后检查

- 确认 DNS 已解析到分配的目标，`https://blog.guangluo.top/` 证书有效。
- 检查首页、文章、图片、搜索、订阅源、站点地图和 404 状态。
- 在大陆宽带及移动网络中对比测试，记录首屏、文章图片与失败请求；境外区不保证解决所有跨境连接问题。
- 将 `https://blog.guangluo.top/sitemap.xml` 提交到搜索引擎站长平台。
- 只维护 `blog.guangluo.top`，旧 GitHub Pages 地址停止更新。

参考：[Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)、[Pages 自定义域名](https://developers.cloudflare.com/pages/configuration/custom-domains/)。

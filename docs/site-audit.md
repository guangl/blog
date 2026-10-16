# 线上站点定时体检

`tools/audit-live.mjs` 打的是**线上站点**，不是本地构建产物。

本地自检（`bun run verify:domain` + `tools/check-site.mjs`）只能证明「产物里该有的东西都有」。它看不到线上真实的一面：响应头到底有没有发出去、证书还有几天到期、页面里的外链有没有烂掉。这三点只有真的请求一次线上地址才知道，所以单独做了这个体检，由 `.github/workflows/site-audit.yml` 每周跑一次。

零第三方依赖，只用 Node 标准库（`node:fs` / `node:tls` / `node:vm` / 全局 `fetch`），所以 CI 里不需要 `bun install`。

## 检查内容

| 部分 | 做什么 | 失败条件 | 告警条件 |
| --- | --- | --- | --- |
| 可用性 | 页面清单取自线上 `sitemap.xml`，逐个请求断言 200 | 任何页面不是 200，或压根没拿到状态码（已重试一次） | — |
| 安全响应头 | 比对首页响应的 7 个安全头 | 缺任何一个头，或取值与 `scripts/cloudflare-headers.js` 不一致 | 读不出源文件时只查「有没有」，不比对取值（并告警） |
| TLS 证书 | 连 host:443 读 `getPeerCertificate()` | 剩余有效期少于 14 天；或证书本身有问题（过期 / 自签 / 域名不匹配） | 连不上（超时、端口不通、CI 断网），跳过检查 |
| 外链 | 抓页面正文，收集所有 http(s) 外链并去重，并发逐个检查（并发 ≤ 5，带超时，浏览器 UA） | `404`、`410` | `401/403/405/429`、其余 4xx/5xx、超时、DNS 失败、TLS 失败 |

页面清单就是「线上 `sitemap.xml` 里的 URL」加上兜底的 6 条：`/`、`/posts/`、`/about/`、`/atom.xml`、`/robots.txt`、`/sitemap.xml`。sitemap 读不到（线上挂了、还没部署）时会明确告警并退回这 6 条。

安全响应头的期望值**从 `scripts/cloudflare-headers.js` 现读**：那个构建期 Hexo 插件会在 `node:vm` 沙箱里跑一遍，交回它本来要写进 `public/_headers` 的 `/*` 段，再逐个头比对。这样脚本里没有第二份 CSP 抄本——改了源文件却忘了重新部署，体检就会把那处不一致指出来（只截第一处差异，不刷屏）。`/*` 上的 `Cache-Control` 不参与比对：Cloudflare 命中多条缓存规则时会把同一个头的值用逗号拼起来，逐字符比没有意义，而 `tools/check-site.mjs` 本来就守着「`/*` 上不许有 Cache-Control」。

## 判定规则：失败 vs 告警

- **失败**（退出码 1，CI 变红）：页面不是 200、安全头缺失或不一致、证书将到期或证书本身有问题、外链 `404`/`410`。这些都是「站点真的坏了」。
- **告警**（退出码 0，CI 保持绿色）：证书检查因网络不通被跳过、外链 `401/403/405/429` 或其它 4xx/5xx、外链超时/DNS 失败/TLS 失败。

### 为什么外链的 403/429 不算失败

因为那是**对方服务器在拦脚本客户端**，不是链接坏了：

- Cloudflare、Akamai 这类 CDN 会按 User-Agent、TLS 指纹、请求频率做机器人拦截，无头/脚本请求很容易吃到 403 或 429，正常浏览器点进去却是好的。`429` 更是明确的「你请求太快了」。
- `405` 是对方不接受这个 HTTP 方法，`401` 是需要登录——链接对真人仍然可用。
- 反过来，`404` / `410` 是对方明确说「这个资源不存在了」，跟谁在请求无关。这是链接真的烂了，必须修。

所以外链检查只对**确定性失效**报警，不确定的一律降级成告警列出来供人工判断。这也跟 `tools/ping-search.mjs` 的取舍一致：第三方抖动不该把一次成功的发布弄失败。

体检脚本连不上本站时同样降级：证书那一项在 CI 断网、被墙、端口不通时只告警，不让一次网络抖动变成一条误导人的红。页面可用性会补一次重试，但重试后仍拿不到响应的算失败——本站打不开就是真的打不开。

## 本地怎么跑

```bash
node tools/audit-live.mjs                              # 体检线上正式站点
node tools/audit-live.mjs --base http://127.0.0.1:4001/ # 体检别处（比如本地 hexo server）
node tools/audit-live.mjs --json                       # 机器可读输出，只输出 JSON
node tools/audit-live.mjs --concurrency 3 --timeout 10000
node tools/audit-live.mjs --help
```

- `--base <url>` 默认 `https://blog.guangluo.top/`。
- `--concurrency <n>` 默认 5，脚本内部硬性封顶 5（外站不是自家 CDN）。
- `--timeout <ms>` 默认 15000，允许 100-120000。
- `--json` 输出结构化结果（`sections.pages` / `sections.headers` / `sections.tls` / `sections.links` + `summary` + `ok`），正文 HTML 不会进 JSON。
- 退出码：`0` 没有失败（可能只有告警）、`1` 有失败、`2` 参数写错了。

默认输出是四段人类可读清单加末尾汇总（通过 / 告警 / 失败各多少条），带 `✗` 的行就是失败项。

注意：安全头与证书这两项是针对 **Cloudflare Pages 通道**写的。`deploy/server-setup.sh` 的 Nginx 通道**故意没开 HSTS**、也没有 `_headers` 文件，用 `--base` 直接指向 ECS 地址时，HSTS 那一项会按预期报失败——这不是 bug，是两条通道本来就不一样。

## CI：.github/workflows/site-audit.yml

- 触发：`schedule` 每周一 `0 1 * * 1`（cron 是 UTC；对应北京时间每周一 09:00）+ 手动 `workflow_dispatch`。
- 权限只有 `contents: read`；`concurrency` 组 `site-audit` 防止定时与手动触发撞车。
- 步骤只有三步：checkout（脚本要读 `scripts/cloudflare-headers.js`，所以必须 checkout）→ setup-node 22 → `node tools/audit-live.mjs`。不需要 bun。
- 红绿语义与脚本退出码一致：退出码 1 这一步才红，只有告警时是绿的，所以刻意不加 `continue-on-error`。
- 与 `deploy-cloudflare.yml`、`deploy-server.yml` 互不依赖：体检红了不会拦住发布，发布失败也不会影响体检。

GitHub 会在仓库连续 60 天没有活动时自动停掉定时工作流。这个仓库只要有提交就不会触发这条规则；真的被停掉了，去 Actions 页面重新启用，或手动 `Run workflow`。

## 后续可以加什么

- **跑到真实浏览器里**：现在的外链检查只发 HTTP 请求，`tools/browser-check.mjs` 已经有 CDP 客户端，可以复用来看线上页面有没有控制台报错、CSP 违规、裂图。
- **证书链与 SAN 校验**：现在只看到期时间，可以顺手比对证书覆盖的域名。
- **Nginx 通道单独体检**：把 HSTS 这类「通道差异」做成按 `--base` 自动判断，或者给脚本加一个 `--channel cloudflare|nginx`。
- **结果留痕**：把 `--json` 写进 Actions 的 `$GITHUB_STEP_SUMMARY`，或者贴到外部监控里看趋势（现在只在日志里）。
- **性能预算**：顺手量首页 HTML / CSS 的体积与首字节时间，超阈值告警。
- **外链白名单**：给已知会拦脚本客户端的站点（Cloudflare 网关后面的站）加一份白名单，少一些噪音告警。

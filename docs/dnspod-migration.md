# DNSPod 地域解析迁移

2026-10-17 准备：域名注册商是阿里云；当前权威 DNS 为 Cloudflare。DNSPod 区域已创建；不以本地文档代替线上状态。

## 已准备的记录

| 主机记录 | 类型 | 线路 | 值 | 状态 | TTL |
| --- | --- | --- | --- | --- | --- |
| blog | CNAME | 默认 | guangluo-blog.pages.dev | 开启 | 600 |
| blog | A | 境内 | 82.156.50.189 | 暂停，备案后再开启 | 600 |
| @ | TXT | 默认 | 保留原 Google 验证值 | 开启 | 600 |

Cloudflare 记录页已核对共两条：上述 CNAME 和 TXT；没有邮件、裸域网站或 www 记录。DNSPod 自动扫描的 A/AAAA 是 Cloudflare 代理地址，已跳过，没有导入。

## 切换权威 DNS

在阿里云 `guangluo.top` 的 DNS 修改页，替换为 DNSPod 此域名实际分配的服务器：

- lyrics.dnspod.net
- bamboo.dnspod.net

原服务器（回滚使用）：

- elias.ns.cloudflare.com
- etta.ns.cloudflare.com

2026-10-17 WHOIS 显示 DNSSEC 为 unsigned。提交前仍需核对注册商 DNSSEC 页没有遗留 DS；不要在有旧 DS 时直接切 NS。

切换前保留 Cloudflare 旧区域与记录，并确认 Pages 自定义域名 `blog.guangluo.top` 已绑定。先以不同网络检查 DNSPod 的默认 CNAME、Google TXT 和 HTTPS，Pages 自定义域名仍须保持 active。NS 传播期间两家 DNS 的有效网站目标均为 Pages；境内 A 保持暂停。

若遇到 Pages 自定义域名或证书异常，先恢复原 NS，不删除旧 Cloudflare 区域。

## 证书续期

`tools/ssl-renew.mjs` 支持 `CERT_DNS_PROVIDER=auto`（默认）。权威 NS 为 Cloudflare 时沿用现有 Token；变为 DNSPod 后使用腾讯云 CAM 密钥写验证 TXT。其他 DNS 服务商无法识别时拒绝申请，要求显式选择提供商。

DNSPod 分支需要在该域名范围内允许：

- dnspod:DescribeDomain
- dnspod:CreateRecord
- dnspod:DeleteRecord

代码与 workflow 必须先发布到远程定时任务使用的分支。当前会话没有读取 GitHub 中密钥的值，也没有创建新密钥或扩大 CAM 权限；不能仅凭本地测试认定远程权限满足。

先用只读 DescribeDomain 验证现有 CAM 权限；确认 NS 传播完成，再让续期任务使用 DNSPod。测试不应为了迁移强制申请新证书。若权限不足，应先补齐授权或采用现有文件验证流程，不能继续向旧 Cloudflare 区域写 TXT。

## 备案通过后的启用

1. 同步同一份构建产物到 ECS 与 Pages。
2. 用 `curl --resolve blog.guangluo.top:443:82.156.50.189 https://blog.guangluo.top/` 校验 ECS 证书和首页。
3. 填写真实备案号，并确认接入状态。
4. 开启 DNSPod `blog / A / 境内 / 82.156.50.189`。
5. 用 ITDOG 缓慢测试分别验证大陆与境外解析结果、HTTP 成功率和耗时。

参考：[Pages 外部 DNS](https://developers.cloudflare.com/pages/configuration/custom-domains/)、[DNSPod 线路优先级](https://docs.dnspod.cn/dns/line-priority/)。

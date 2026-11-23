---
title: 家庭网络改造实录：UniFi、Mac mini 与 Surge 的分工
date: 2026-10-18 03:10:00
updated: 2026-11-23
categories:
  - 网络
tags:
  - UniFi
  - WireGuard
  - Surge
  - AdGuard Home
  - SmartDNS
  - sing-box
description: 家庭主网使用 192.168.10.0/24。Mac mini 原生运行 AdGuard Home 和 sing-box，SmartDNS 留在 OrbStack，UniFi 负责路由，群晖 DSM 提供应用入口。
cover: /images/network-rebuild.svg
article:
  ai_label: generated
---

家里的网络经历了几轮调整。最初是主网与 Surge 网关网络并存，后来由 UniFi 按策略把流量通过 WireGuard 送到 NAS，再交给 Mac mini 上的 Surge。DNS 和 WireGuard 接收端随后一起迁到 Mac mini，NAS 专注于存储、应用和 HTTPS 入口。

现在连 DNS 的第一跳也从容器里拆了出来。AdGuard Home 由 macOS 原生进程接收客户端查询，SmartDNS 仍在 OrbStack 里负责选择上游。下载直连、WireGuard 和 DSM 反代各有自己的路径，排查时可以从出问题的那一段查起。

本文按 **2026 年 11 月 23 日**对 Mac mini、NAS 和一台局域网客户端的只读核对更新。下文分别记录运行配置和实测结果。

<!-- more -->

## 一、现在的设备分工

家庭主网仍是 `192.168.10.0/24`。

| 设备 | 地址 | 当前职责 |
| --- | --- | --- |
| UniFi / UDM | `192.168.10.1` | 客户端默认网关与路由策略 |
| Mac mini | `192.168.10.4` | AdGuard Home、SmartDNS、sing-box、Surge，以及 Tailscale 和相册机器学习 |
| 群晖 NAS | `192.168.10.5` | DSM 反向代理、存储、影音、相册、监控与通知 |
| qBittorrent | `192.168.10.6` | 独立局域网地址的下载服务 |

Mac mini 上，AdGuard Home 由 launchd 启动，旧容器已停用。SmartDNS 使用 OrbStack 的 host 网络。sing-box 和 Surge 都直接在 macOS 上运行。NAS 继续承担 DSM 反代、存储和应用，下载器通过 macvlan 取得独立的局域网地址。

```text
家庭客户端 → UniFi / UDM
               ├─ 本地与直连路径 → 对应目标
               └─ 策略选中的流量 → WireGuard → Mac mini sing-box
                                              ├─ 命中直连规则 → 目标
                                              └─ 其余 → Surge SOCKS5 → 代理出口

客户端 DNS → Mac mini 原生 AdGuard Home :53
                ├─ 本地重写与过滤
                └─ OrbStack SmartDNS 127.0.0.1:6053
                    ├─ 国内域名组 → 国内加密 DNS
                    ├─ 指定域名 → UDM DNS
                    └─ 默认组 → Surge SOCKS5 → 境外 DoH
```

## 二、DNS：AdGuard Home 原生接入，SmartDNS 分组解析

### AdGuard Home 接收查询

原生 AdGuard Home 在 `0.0.0.0:53` 接收 UDP 和 TCP 查询，管理界面监听 `6200`。普通上游是本机 `127.0.0.1:6053` 的 SmartDNS。配置中还保留了两条备用上游：

```yaml
upstream_dns:
  - 127.0.0.1:6053
fallback_dns:
  - https://doh.pub/dns-query
  - https://dns.cloudflare-dns.com/dns-query
cache_size: 4194304
aaaa_disabled: false
```

AdGuard 保留 4 MiB 缓存。它的备用 DoH 上游绕过 SmartDNS，启用时会使用不同的解析路径。

测试客户端从 UDM 收到的 DHCP 租约里，默认网关是 `192.168.10.1`，DNS 依次是 Mac mini 的 `192.168.10.4` 和 UDM 的 `192.168.10.1`。直接向 UDM 查询时，`home`、`movie` 和 `metadata` 返回了 NAS 地址，`photo`、`download` 和 `ha` 则返回 NXDOMAIN。客户端使用第二个 DNS 时，部分日常应用域名可能会失效。

### SmartDNS 选择上游

SmartDNS 在回环地址监听 UDP 和 TCP 的 `6053`。命中国内域名表的查询使用 `domestic` 组，具体域名也可以覆盖默认分组。

```text
国内组：阿里 DoH / 腾讯 DoT，直接连接
默认组：Cloudflare / Google DoH，经 Surge SOCKS5
```

境外上游保留域名 URL，并固定连接 IP，例如：

```text
proxy-server socks5://192.168.10.4:6153 -name surge
server-https https://cloudflare-dns.com/dns-query -host-ip 1.1.1.1 -proxy surge
server-https https://dns.google/dns-query -host-ip 8.8.8.8 -proxy surge
server-https https://dns.alidns.com/dns-query -host-ip 223.5.5.5 -group domestic -exclude-default-group
server-tls tls://dot.pub:853 -host-ip 120.53.53.53 -tls-host-verify dot.pub -group domestic -exclude-default-group
nameserver /domain-set:china/domestic
```

域名 URL 配合 CA 证书用于校验上游身份，固定连接地址减少解析 DoH 服务自身域名的依赖。国内组排除在默认组之外，只由对应规则选择。

当前还为代理入口域名单独指定国内解析，并关闭这些域名的缓存和过期缓存，限制 TTL，避免“解析代理入口本身又需要代理”的循环依赖。具体入口名称随订阅变化，不在文章中列出。

SmartDNS 缓存容量为 16384，启用持久化、预取和过期缓存；过期服务窗口为 300 秒，返回过期记录的 TTL 为 3 秒。现在有两层缓存，排查时需要区分 AdGuard 命中、SmartDNS 命中和真正访问上游的查询。

VS Code 下载域名 `vscode.download.prss.microsoft.com` 交给 UDM DNS 解析，让客户端与 UDM 的域名策略使用同一来源的 CDN 地址。本轮向两台 DNS 分别查到的 A 记录集合一致。进入 sing-box 后，该域名的 TCP 443 也有一条优先送往 Surge 的规则。

### 本地域名与 IPv6

两层都保存了本地记录。AdGuard Home 有 `home`、`photo`、`ha`、`metadata` 等指向 NAS 的重写，SmartDNS 保留含 `dsm` 在内的本地地址，并对这些记录抑制 AAAA。AdGuard 仍允许全局 AAAA 查询。实测 `photo` 有本地 A 记录，AAAA 查询成功返回空答案。

`mini`、`draw`、`drawdb`、`read` 和旧管理域名 `nginx` 仍解析到 Mac mini。实测这五个域名的 HTTPS 端口均未建立连接。

### 广告过滤与专项解析

AdGuard Home 启用 AdGuard DNS、AdAway 和由 Johnshall Shadowrocket 广告列表转换的本地域名规则。Mac mini 每天北京时间 08:30 运行转换，跳过 IP 规则。11 月 23 日 08:30 更新的本地文件含 54,168 条域名规则。AdGuard 的过滤列表刷新间隔是 24 小时。

`mcdn.bilivideo.cn` 在 AdGuard 被重写为 NXDOMAIN，本轮直接查询确认了结果。SmartDNS 对 `appleid.cdn-apple.com` 指定国内上游，并禁用该域名的 SmartDNS 缓存和过期记录。

## 三、UniFi 策略路由和 WireGuard

UniFi 控制器有八条已启用的策略。Mac mini 和 qBittorrent 各有一条设备级规则，经 WAN1 直出。主网的中国区域流量、国内 DNS 和一组指定 IP 也走 WAN1，MacBook 的指定 Surge 节点另有直连规则。

主网的外网分流策略 `Foreign-Via-MacMini` 指向 WireGuard 客户端 `MacMini-Surge-WG`，并启用了 Kill Switch。VS Code 下载域名也单独指向这条 WireGuard 路径，配合前面的 DNS 规则和后面的 sing-box 规则。UDM 的隧道地址为 `10.69.69.2/32`。

运行中的 sing-box 使用 `gateway-mac.json`，内置 WireGuard endpoint 的主要参数为：

| 参数 | 当前值 |
| --- | --- |
| 类型 | `wireguard` |
| 标签 | `wg-home` |
| 实现模式 | `system: false` |
| 监听端口 | UDP `51820` |
| 本端隧道地址 | `10.69.69.1/30` |
| MTU | `1408` |
| 默认代理出口 | SOCKS5 `192.168.10.4:6153` |

隧道接收、路由与代理入口现在都在 Mac mini 上。这样少了一段跨主机转发，但 Mac mini 停机时，DNS、隧道处理和代理出口可能同时受影响。

## 四、分流规则：下载优先直连，其余逐项匹配

对进入 sing-box 的流量，当前配置顺序如下：

1. 下载器来源地址 `192.168.10.6/32`、`172.30.61.2/32` 直连。
2. 私网目的地址直连。
3. 执行协议嗅探，随后将 VS Code 下载域名的 TCP 443 交给 Surge。
4. 显式列出的 Tracker 主机直连。`mikanani.me` 的 TCP 交给 Surge，其余连接继续匹配种子源后缀与 tracker / torrent 关键词直连。
5. 识别为 BitTorrent 的连接，以及命中 `xunlei` 或 `sandai` 关键词的连接直连。
6. 命中指定 IP 的无域名 TCP 443 和 993 流量，以及命中 Telegram 网段的 TCP 流量，交给 Surge。
7. 无域名且未识别为 HTTP、TLS 或 SSH 的 TCP 流量直连。
8. Google 域名保护规则命中且目的 IP 不在国内 IP 规则集内时，TCP 交给 Surge。
9. 命中国内 IP 或域名规则集时直连。
10. 拒绝仍未匹配的 UDP 443，其余 UDP 通过 `nintendo-udp` 直连。
11. 剩余流量通过 Surge SOCKS5。

下载器来源和国内规则都排在 UDP 443 拒绝之前。拒绝规则处理前面仍未匹配的 UDP 443，应用是否改用 TCP 取决于客户端。

当前国内 IP 与域名规则集使用本地二进制文件，运行配置没有沿用旧模板的远程每日更新声明。维护时需要另外核对本地文件的更新来源和周期。

### 为什么下载要按来源地址匹配

固定来源规则覆盖下载器的全部连接，能处理无法仅靠协议嗅探识别的加密流量。代价是来自这些地址的普通 HTTPS 请求也会直连，无法自动区分用途。

Surge Profile 也配置了下载器进程和 Tracker 直连，`mikanani.me` 精确匹配使用 `Regional-Failover`。无域名 TCP 规则的匹配范围比下载流量更广，满足条件的其他 TCP 流量也会直连。

## 五、代理、应用入口与远程访问

Mac mini 的 Surge 提供局域网 HTTP 代理 `6152` 和 SOCKS5 `6153`。sing-box 和 SmartDNS 使用 SOCKS5。核对的 `HomeSplit-Unified` 配置中，Surge 自身的 DNS 为 `223.5.5.5, system`，OpenAI 相关域名使用统一策略组并启用 `extended-matching`。

应用域名的 HTTPS 入口由群晖 DSM 反向代理提供。Home Assistant 和 Collect Metadata 的后端在 NAS，下载入口接到 qBittorrent 的 Docker 控制网，AdGuard 管理入口跨主机转到 Mac mini 的 `6200`。Mac mini 的 Nginx Proxy Manager 容器仍处于停止状态。各域名对应的后端见《我的 Homelab》。

Mac mini 的 Tailscale 在线，当前承担 `192.168.10.0/24` 的子网路由，所在 Tailnet 已启用 MagicDNS。这个入口供远程客户端访问家中设备。UDM 到 sing-box 的 WireGuard 则处理家中设备的出网流量。

## 六、网络巡检与核对范围

Mac mini 的 DNS watchdog 每分钟运行，UDM DHCP 检查每五分钟运行。本轮确认了这两项 launchd 任务。旧的 NetPulse 和 IPFIX 任务文件仍在，launchd 中未加载。

| 检查 | 11 月 23 日结果 |
| --- | --- |
| Mac mini DNS | 内网记录、百度和 Cloudflare 返回 A 记录。`www.google.com` 首测有一次超时，复测 UDP 和 TCP 均返回 A 记录 |
| UDM DNS | 能解析部分内网域名，`photo`、`download` 和 `ha` 返回 NXDOMAIN |
| DSM HTTPS 反代 | 绕过客户端 HTTP 代理并校验证书，11 个应用入口返回 HTTP 200 或 302 |
| DSM 域名 | `nas.guangluo.top` 通过 HTTPS 校验。`dsm.guangluo.top` 返回的证书与域名不匹配 |
| 下载器 | 从局域网直接访问 `192.168.10.6:8080` 返回 HTTP 200 |

本轮的连通性检查从一台接入家庭主网的 MacBook 发起。UniFi 的策略条目和出站目标来自控制器配置。规则重叠时的实际命中顺序、WireGuard 握手与计数、真实下载流量的出口，以及断电重启、IPv6 连通性和外网访问仍缺当日实测。

应用、媒体目录与备份的整体安排见 [《我的 Homelab》](/2026/11/03/my-homelab/)。

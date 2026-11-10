---
title: 家庭网络改造实录：UniFi、Mac mini 与 Surge 的分工
date: 2026-10-18 03:10:00
updated: 2026-11-08
categories:
  - 网络
tags:
  - UniFi
  - WireGuard
  - Surge
  - AdGuard Home
  - SmartDNS
  - sing-box
description: 家庭主网保持 192.168.10.0/24，DNS 与 WireGuard 网关迁到 Mac mini，由 AdGuard Home、SmartDNS、sing-box 和 Surge 分工，群晖 DSM 负责应用反向代理。
cover: /images/network-rebuild.svg
article:
  ai_label: generated
---

家里的网络经历了几轮调整：先是主网与 Surge 网关网络并存，后来让 UniFi 按目的 IP 分流，把需要处理的连接通过 WireGuard 送到 NAS，再转交 Mac mini 上的 Surge。如今又把 NAS 上的网络服务迁到了 Mac mini，NAS 承担存储、应用和域名入口。

这次调整的重点是减少网络对 NAS 的依赖。NAS 更新、重启或整理容器时，不必同时承担 DNS 与代理转发服务的维护。

本文按 **2026 年 11 月 8 日对 NAS、Mac mini 和一台客户端的只读核对**更新。设备地址、运行进程、DNS 配置和 sing-box 规则取自现机；UniFi 的完整策略顺序没有在本轮重新读取，故障切换与整机重启也没有重新演练。旧版文章中的五容器方案和重启测试属于当时的实现，不作为当前架构的验收结果。

<!-- more -->

## 一、现在的设备分工

家庭主网仍是 `192.168.10.0/24`。

| 设备 | 地址 | 当前职责 |
| --- | --- | --- |
| UniFi / UDM | `192.168.10.1` | 客户端默认网关与路由策略 |
| Mac mini | `192.168.10.4` | AdGuard Home、SmartDNS、sing-box、Surge，以及 Tailscale 和相册机器学习 |
| 群晖 NAS | `192.168.10.5` | DSM 反向代理、存储、影音、相册、监控与通知 |
| qBittorrent | `192.168.10.6` | 独立局域网地址的下载服务 |

Mac mini 上，AdGuard Home 和 SmartDNS 使用 Docker host 网络；sing-box 由 macOS 原生进程运行，Surge 也是原生应用。核对时 Mac mini 有三个运行容器：AdGuard Home、SmartDNS 和 Immich Machine Learning。Nginx Proxy Manager 容器已停止。

NAS 上已没有旧的 `wg-home`、`tproxy`、`dnsq`，也没有此前的 `network-gateway`、SmartDNS 和 AdGuard Home 容器。不能再按旧文章在 NAS 启动五个网络容器，也不能把 11 月 3 日导出的 NAS 网络编排直接当作现在的部署入口。

```text
家庭客户端 → UniFi / UDM
               ├─ 本地与直连路径 → 对应目标
               └─ 策略选中的流量 → WireGuard → Mac mini sing-box
                                              ├─ 命中直连规则 → 目标
                                              └─ 其余 → Surge SOCKS5 → 代理出口

客户端 DNS → Mac mini AdGuard Home :53
                → SmartDNS 127.0.0.1:6053
                    ├─ 国内域名组 → 国内加密 DNS
                    └─ 默认组 → Surge SOCKS5 → 境外 DoH
```

图中 WireGuard 是仍在使用的隧道协议，接收端已经换了主机和实现。UDM 哪些来源、哪些目的地址会进入这条路径，应以控制器实际配置为准。

## 二、DNS：入口迁到 Mac mini，保留分组解析

### AdGuard Home 接收查询

AdGuard Home 监听 `0.0.0.0:53`，普通上游为本机 `127.0.0.1:6053` 的 SmartDNS。当前还配置了两条备用上游：

```yaml
upstream_dns:
  - 127.0.0.1:6053
fallback_dns:
  - https://doh.pub/dns-query
  - https://dns.cloudflare-dns.com/dns-query
cache_size: 4194304
aaaa_disabled: false
```

与上一轮配置不同，AdGuard 的缓存已开启，大小为 4 MiB；不再是“缓存全部集中在 SmartDNS，且没有 fallback”。备用上游也不经过同一套 SmartDNS 域名分组，因此故障时的解析路径可能改变，不能把备用解析等同于完整分流恢复。

本轮测试客户端从 UDM 收到的 DHCP 租约中，默认网关是 `192.168.10.1`，DNS 为 `192.168.10.4` 和 `192.168.10.1`。向 UDM 查询 `home.guangluo.top` 也返回了 NAS 地址。这里记录的是一台客户端的租约与查询结果。

### SmartDNS 选择上游

SmartDNS 在回环地址监听 UDP/TCP `6053`，国内域名表命中后选择 domestic 组，其他查询使用默认组。

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

### 本地域名与 IPv6

SmartDNS 将 `home`、`movie`、`anime`、`download`、`monitor`、`top`、`nas`、`adguard` 和 `dsm` 解析到 NAS `192.168.10.5`，对这些本地记录抑制 AAAA。AdGuard Home 另有一条 `photo.guangluo.top → 192.168.10.5` 的重写。AdGuard 的全局 AAAA 开关保持开启解析。

`mini`、`draw`、`read` 和旧管理域名 `nginx` 仍解析到 Mac mini。本轮从局域网访问这四个域名的 HTTPS 端口未建立连接。

### 广告过滤与专项解析

AdGuard Home 启用 AdGuard DNS、AdAway 和由 Johnshall Shadowrocket 广告列表转换的本地域名规则。Mac mini 每天北京时间 08:30 运行转换，跳过 IP 规则，下载或转换失败时保留上一版。11 月 8 日的任务日志记录写入 53,762 条 DNS 规则。AdGuard 自己的过滤列表刷新间隔是 24 小时。

`mcdn.bilivideo.cn` 在 AdGuard 被重写为 NXDOMAIN，本轮直接查询确认了结果。SmartDNS 对 `appleid.cdn-apple.com` 指定国内上游，并禁用该域名的 SmartDNS 缓存和过期记录。

## 三、WireGuard：由 Mac 原生 sing-box 接收

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

旧文的 `10.66.66.0/24`、NAS 上的 `wireguard-go`、TUN 设备启动钩子、iptables REDIRECT 和 Python `SO_ORIGINAL_DST` 转发，均不再是当前 Mac 网关的配置方式。

这次迁移把隧道接收、路由与代理入口放到同一台 Mac mini 上，减少了 NAS 与 Mac 之间的一段服务依赖。不过 Mac mini 因此承担更多公共网络服务：它停机时，DNS、隧道处理和代理出口可能同时受影响。

## 四、分流规则：下载优先直连，其余逐项匹配

对进入 sing-box 的流量，当前配置顺序如下：

1. 下载器来源地址 `192.168.10.6/32`、`172.30.61.2/32` 直连。
2. 私网目的地址直连。
3. 执行协议嗅探。
4. 显式列出的 Tracker 主机直连。
5. `mikanani.me` 的 TCP 交给 Surge，其余连接继续匹配种子源后缀与 tracker / torrent 关键词直连。
6. 识别为 BitTorrent 的连接，以及命中 `xunlei` 或 `sandai` 关键词的连接直连。
7. 一个特定目的 IP 的无域名 TCP 443 流量交给 Surge。随后，无域名且未识别为 HTTP、TLS 或 SSH 的 TCP 流量直连。
8. Google 域名保护规则命中且目的 IP 不在国内 IP 规则集内时，TCP 交给 Surge。
9. 命中国内 IP 或域名规则集时直连。
10. 拒绝仍未匹配的 UDP 443，其余 UDP 交给 `nintendo-udp`。
11. 剩余流量通过 Surge SOCKS5。

`nintendo-udp` 的实际类型是 `direct`，所以其余 UDP 走直连。不能仅凭出口名字理解成只允许任天堂流量，也不能把它写成通用 UDP 代理。

规则先后有实际影响。下载器来源和国内规则都排在 UDP 443 拒绝之前，因此“所有 QUIC 都被阻断”不准确。拒绝剩余 UDP 443 是为了让支持回退的应用改用 TCP，是否回退仍取决于客户端。

当前国内 IP 与域名规则集使用本地二进制文件，运行配置没有沿用旧模板的远程每日更新声明。维护时需要另外核对本地文件的更新来源和周期。

### 为什么下载要按来源地址匹配

固定来源规则覆盖下载器的全部连接，能处理无法仅靠协议嗅探识别的加密流量。代价是来自这些地址的普通 HTTPS 请求也会直连，无法自动区分用途。

Surge Profile 也配置了下载器进程和 Tracker 直连，`mikanani.me` 精确匹配使用 `Regional-Failover`。无域名 TCP 规则的匹配范围比下载流量更广，满足条件的其他 TCP 流量也会直连。

## 五、代理、应用入口与远程访问

Mac mini 的 Surge 提供局域网 HTTP 代理 `6152` 和 SOCKS5 `6153`。sing-box 和 SmartDNS 使用 SOCKS5。核对的 `HomeSplit-Unified` 配置中，Surge 自身的 DNS 为 `223.5.5.5, system`，OpenAI 相关域名使用统一策略组并启用 `extended-matching`。

应用域名的 HTTPS 入口由群晖 DSM 反向代理提供。大多数后端在 NAS，下载入口转到 qBittorrent 的 Docker 控制网地址，AdGuard 管理入口由 DSM 跨主机转到 Mac mini 的 `6200`。Mac mini 的 Nginx Proxy Manager 容器已停止，实测 `80`、`443` 和 `7001` 均拒绝连接。各域名对应的后端见《我的 Homelab》。

Mac mini 的 Tailscale 处于在线状态，通告家庭主网 `192.168.10.0/24`，所在 Tailnet 启用了 MagicDNS。它提供远程访问的子网路由，与 UDM 将家中流量交给 sing-box 的 WireGuard 路径分开。本轮未从外网客户端验证子网访问。

## 六、网络巡检与核对范围

Mac mini 加载了每分钟运行的 DNS watchdog 和 NetPulse、每五分钟运行的 UDM DHCP 检查，以及 IPFIX 采集进程。本轮核对了任务配置与运行状态。

从局域网查询 AdGuard，应用域名、百度和 Google 均返回 A 记录。绕过客户端 HTTP 代理访问 NAS 上九个应用反代域名，均收到 HTTP 200 或 302。探测时跳过了证书校验，覆盖范围是内网入口响应。

UDM 的完整策略顺序、WireGuard 对端握手和计数，以及整机重启、断线回退、IPv6 和外网访问仍待实测。

应用、媒体目录与备份的整体安排见 [《我的 Homelab》](/2026/11/03/my-homelab/)。

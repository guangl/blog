---
title: 家庭网络改造实录：UniFi、Mac mini 与 Surge 的分工
date: 2026-10-18 03:10:00
updated: 2026-11-06
categories:
  - 网络
tags:
  - UniFi
  - WireGuard
  - Surge
  - AdGuard Home
  - SmartDNS
  - sing-box
description: 家庭主网保持 192.168.10.0/24，DNS 与 WireGuard 网关迁到 Mac mini，由 AdGuard Home、SmartDNS、sing-box 和 Surge 分工，NAS 回归存储与应用。
cover: /images/network-rebuild.svg
article:
  ai_label: generated
---

家里的网络经历了几轮调整：先是主网与 Surge 网关网络并存，后来让 UniFi 按目的 IP 分流，把需要处理的连接通过 WireGuard 送到 NAS，再转交 Mac mini 上的 Surge。如今又把 NAS 上的网络服务迁到了 Mac mini，NAS 主要承担存储和应用。

这次调整的重点是减少网络对 NAS 的依赖。NAS 更新、重启或整理容器时，不必同时承担 DNS 与代理转发服务的维护。

本文按 **2026 年 11 月 6 日对 NAS、Mac mini 的只读核对**更新。设备地址、运行进程、DNS 配置和 sing-box 规则取自现机；UniFi 的完整策略顺序没有在本轮重新读取，故障切换与整机重启也没有重新演练。旧版文章中的五容器方案和重启测试属于当时的实现，不作为当前架构的验收结果。

<!-- more -->

## 一、现在的设备分工

家庭主网仍是 `192.168.10.0/24`。

| 设备 | 地址 | 当前职责 |
| --- | --- | --- |
| UniFi / UDM | `192.168.10.1` | 客户端默认网关与路由策略 |
| Mac mini | `192.168.10.4` | AdGuard Home、SmartDNS、sing-box、Surge，以及反向代理和相册机器学习 |
| 群晖 NAS | `192.168.10.5` | 存储、影音、下载、相册、监控与通知 |
| qBittorrent | `192.168.10.6` | 独立局域网地址的下载服务 |

Mac mini 上，AdGuard Home 和 SmartDNS 使用 Docker host 网络；sing-box 由 macOS 原生进程运行，Surge 也是原生应用。核对时 Mac mini 的四个运行容器是 DNS 两个组件、Nginx Proxy Manager 和 Immich Machine Learning。

NAS 上已没有旧的 `wg-home`、`tproxy`、`dnsq`，也没有此前的 `network-gateway`、SmartDNS 和 AdGuard Home 容器。不能再按旧文章在 NAS 启动五个网络容器，也不能把 11 月 3 日导出的 NAS 网络编排直接当作现在的部署入口。

```text
家庭客户端 → UniFi / UDM
               ├─ 本地与直连路径 → 对应目标
               └─ 策略选中的流量 → WireGuard → Mac mini sing-box
                                              ├─ 命中直连规则 → 目标
                                              └─ 其余 → Surge SOCKS5 → 代理出口

客户端 DNS → Mac mini AdGuard Home :53
                → SmartDNS 127.0.0.1:6053
                    ├─ 国内域名组 → 国内 DoH
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

本轮测试客户端收到的 DNS 地址为 `.4` 和 `223.5.5.5`。这是该客户端的实际配置，不代表已经核对全部设备的 DHCP 租约。直接使用公共 DNS 的查询不会经过家中的 AdGuard 过滤与本地域名规则，不能据此声称全网所有查询都统一过滤。

### SmartDNS 选择上游

SmartDNS 在回环地址监听 UDP/TCP `6053`，国内域名表命中后选择 domestic 组，其他查询使用默认组。

```text
国内组：阿里 / 腾讯 DoH，直接连接
默认组：Cloudflare / Google DoH，经 Surge SOCKS5
```

境外上游保留域名 URL，并固定连接 IP，例如：

```text
proxy-server socks5://192.168.10.4:6153 -name surge
server-https https://cloudflare-dns.com/dns-query -host-ip 1.1.1.1 -proxy surge
server-https https://dns.google/dns-query -host-ip 8.8.8.8 -proxy surge
server-https https://dns.alidns.com/dns-query -host-ip 223.5.5.5 -group domestic -exclude-default-group
nameserver /domain-set:china/domestic
```

域名 URL 配合 CA 证书用于校验上游身份，固定连接地址减少解析 DoH 服务自身域名的依赖。国内组排除在默认组之外，只由对应规则选择。

当前还为代理入口域名单独指定国内解析，并关闭这些域名的缓存和过期缓存，限制 TTL，避免“解析代理入口本身又需要代理”的循环依赖。具体入口名称随订阅变化，不在文章中列出。

SmartDNS 缓存容量为 16384，启用持久化、预取和过期缓存；过期服务窗口为 300 秒，返回过期记录的 TTL 为 3 秒。现在有两层缓存，排查时需要区分 AdGuard 命中、SmartDNS 命中和真正访问上游的查询。

### 本地域名与 IPv6

`home`、`movie`、`anime`、`download`、`monitor`、`top`、`nginx`、`nas`、`adguard` 等服务域名解析到 Mac mini `.4`，由 NPM 转发到后端；`dsm.guangluo.top` 则直接指向 NAS `.5`。这些本地域名单独抑制 AAAA。

当前 SmartDNS 文件仍未单独定义 `photo.guangluo.top`，不能由 NPM 中存在相册转发条目推断本地 DNS 已经覆盖它。AdGuard 没有全局禁用 AAAA，也不能把旧方案的 IPv6 限制照搬到现在。

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
4. Tracker 主机、种子源域名与 tracker / torrent 关键词直连。
5. 识别为 BitTorrent 的连接直连。
6. 命中国内 IP 或域名规则集时直连。
7. 尚未匹配的 UDP 443 拒绝。
8. 其余 UDP 交给 `nintendo-udp` 出口。
9. 剩余流量通过 Surge SOCKS5。

`nintendo-udp` 的实际类型是 `direct`，所以其余 UDP 走直连。不能仅凭出口名字理解成只允许任天堂流量，也不能把它写成通用 UDP 代理。

规则先后有实际影响。下载器来源和国内规则都排在 UDP 443 拒绝之前，因此“所有 QUIC 都被阻断”不准确。拒绝剩余 UDP 443 是为了让支持回退的应用改用 TCP，是否回退仍取决于客户端。

当前国内 IP 与域名规则集使用本地二进制文件，运行配置没有沿用旧模板的远程每日更新声明。维护时需要另外核对本地文件的更新来源和周期。

### 为什么下载要按来源地址匹配

固定来源规则覆盖下载器的全部连接，能处理无法仅靠协议嗅探识别的加密流量。代价是来自这些地址的普通 HTTPS 请求也会直连，无法自动区分用途。

Surge 的下载直连规则与应用代理开关属于另一层配置。本文本轮核对了 sing-box 的来源规则，没有重新读取下载器 API 和全部 Surge 运行规则，不能只据这条规则就宣称所有下载路径已经完成出口验收。

## 五、Surge 与应用入口

Surge 提供局域网 HTTP 代理 `6152` 和 SOCKS5 `6153`。sing-box 和 SmartDNS 使用后者。Surge 继续负责代理节点选择和域名策略，OpenAI 相关域名仍配置为使用统一策略组，并启用 `extended-matching`。

本轮读取的 Profile 里，`dns-server` 为 `223.5.5.5, system`，主网包含在隧道排除路由中。配置文件里的规则表达了预期行为；具体连接是否命中、出口是否一致，仍需要连接记录和实际请求核对。

Nginx Proxy Manager 继续运行在 Mac mini，监听 `80`、`443` 与管理端口 `7001`。它负责应用域名入口，与 sing-box 的出网代理职责分开。现在 NPM 容器没有显式设置旧的 `192.168.5.1` DNS，旧文中的这条遗留配置也需要同步删去。

## 六、本轮核对与运行边界

本次直接核对了两台主机的容器列表、Mac 上的 sing-box 进程及配置、Surge Profile、DNS 配置和客户端默认网关。客户端默认网关为 `.1`，DNS 列表为 `.4` 与 `223.5.5.5`；向 `.4` 查询本地域名、百度和 Google 均收到 A 记录回答。另外，客户端显式绕过应用代理访问百度与 Google 均返回 HTTP 200，Mac 上 sing-box 配置检查通过；尚未结合 UDM 与 Surge 日志确认完整路径。

以下项目仍需用当前架构重新验证：

- UDM 的实际策略顺序、WireGuard 对端与握手、收发计数。
- Mac mini 整机重启后，Docker DNS、sing-box 与 Surge 是否按顺序自动恢复。
- NAS 离线时，客户端解析、国内访问和境外访问是否仍符合预期。
- Mac mini 离线时，客户端公共备用 DNS、UDM 隧道失效及直连回退的实际表现。
- IPv6、其他 UDP、浏览器登录与特定服务的出口一致性。

旧方案曾观察到 WireGuard 断开后境外流量回落直连；这是一条历史风险记录，不能证明现在仍如此，也不能证明现在已经有完整断线保护。当前配置没有经过本轮断线演练，仍应实测。

从双网段到 NAS 五容器，再到 Mac mini 集中网络服务，日常使用始终围绕同一个目标：客户端尽量少配置，规则集中维护。现在减少了网络与 NAS 应用维护之间的耦合，同时提高了对 Mac mini 的依赖。下一步要补齐的是当前方案的重启和故障记录。

应用、媒体目录与备份的整体安排见 [《我的 Homelab》](/2026/11/03/my-homelab/)。

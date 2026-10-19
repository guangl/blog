---
title: 家庭网络改造实录：用 UBNT 策略路由 + WireGuard + Surge 做 IP 级分流
date: 2026-10-18 03:10:00
updated: 2026-10-19 15:21:10
categories:
  - 网络
tags:
  - UniFi
  - WireGuard
  - Surge
  - AdGuard Home
  - Synology
description: 用 UBNT 按真实 IP 分流、NAS 经 WireGuard 转发到 Surge，并补齐 TLS 域名、DNS 缓存和 QUIC 路径，排查 ChatGPT 登录 403 与出口不一致。
cover: /images/network-rebuild.svg
article:
  ai_label: generated
---

## 缘起

家里的网络一直是这样：主网段 `192.168.10.0/24`（UBNT 网关），另一个 `192.168.15.0/24` 跑 Surge 网关模式，需要代理的设备连后者。

用久了发现几个问题：

- Wi-Fi 一旦连到 Surge 那套，所有流量（包括大陆）都先进 Surge，由它按域名裁决，链路多一跳；
- DNS 被 Surge 的 fake-IP 接管，排查问题时看到的全是 `198.18.x.x`；
- 想把“大陆直连、其余走代理”交给 UBNT 用**真实 IP** 判断，而不是由客户端 DNS 决定。

于是有了这次改造。目标定得很具体：

1. 日常 Wi-Fi（`1401`）回到主网段，客户端网关是 UBNT；
2. UBNT 只做普通路由，不把内网流量送进代理通道；
3. UBNT 按**真实目的 IP** 分流：大陆优先 WAN，其余送验证过的 VPN 出口；
4. 只对客户端来源应用代理策略，代理节点自身的连接必须走普通 WAN；
5. DNS 返回真实 IP，保留家庭域名；
6. 未验证 IPv6 之前不宣称同策略；
7. 代理通道失效时，内网和大陆 IP 仍正常。

<!-- more -->

## 改造前先验证的五个问题

正式调整网络前，先检查 DNS 能否返回正确地址、Surge 能否接收转发流量，以及 UBNT 的策略在隧道断开后会怎样。下面记录这次配置下的测试结果，以及它们对方案的影响。

### 1. DNS 返回的地址是否正确

按目的 IP 分流前，要先确认解析结果可用。同一个域名分别查询两个解析器，结果如下：

| 域名 | `223.5.5.5` | 经代理的 DoH |
|---|---|---|
| www.google.com | 空（超时） | `142.251.155.119` |
| www.youtube.com | `104.244.42.197`（推特 IP） | `142.251.154.4` |
| www.baidu.com | 正确的国内 IP | — |

**DNS 污染意味着"IP 级分流"的前提是拿到真实 IP**，否则分流做得再准，连的也是个假地址。因此，先确定 DNS 的解析路径，再配置 IP 分流规则。

### 2. 把下一跳设为 Surge，流量能否转发

在当时的 Surge 网关配置下，从不是由它分配 DHCP 地址的设备发起测试，未能通过 `.161` 出网：

```
surge = 192.168.15.161
ip route add 34.117.59.81 via 192.168.15.161   → TCP 超时
默认网关临时改成 .161                          → 全部出网超时
端口 53/80/443/6152/6153/6170/9090             → 全部 closed
```

这组结果说明，当时不能直接把 `.161` 当成其他设备的下一跳。最初依赖 Surge 网关模式的方案需要调整，后来改为由 NAS 接收隧道流量，再显式连接 Surge 的 SOCKS 服务。这是本次配置下的结果，不能据此认定所有 Surge 网关配置都不支持转发。

### 3. WireGuard 断开后，国外流量会不会直连

为了确认 UBNT 的 kill switch 是否生效，做了三组检查：

- 杀掉隧道服务端进程；
- 在 UDM 上把客户端 `enabled: false`；
- 对比 UI 创建的规则与 API 创建的规则（字段完全一致，无隐藏开关）。

前两组断线测试中，国外流量都**回落直连**；对比规则字段也没有找到能改变这一行为的配置。检查时没有发现对应的内核丢包规则，因此这套配置不能依赖 kill switch 阻止断线后的直连。

### 4. UBNT 的 next_hop 字段是否真的改变转发路径

尝试通过策略路由的 `next_hop` 把流量交给局域网机器。API 返回 201，但测试流量仍从 WAN 出去；换成测试地址 `192.0.2.1`，结果也一样。API 接受了字段，不代表转发路径已经改变，因此最终采用 WireGuard 作为策略出口。

### 5. DHCP 是否把新 DNS 地址发给了客户端

修改 DNS 地址后，还需要检查 UDM 的 `rest/networkconf` 中的 `dhcpd_dns_enabled` 开关。本次配置里，**开关关闭时，填写 `dhcpd_dns_1` 不会让客户端收到该地址**，客户端拿到的仍是网关 `192.168.10.1`。

这个坑卡了很久——设备重连了 Wi-Fi 还是旧 DNS，一度以为是 macOS 缓存。

## 最终架构

放弃 VLAN，全部设备在 `192.168.10.0/24`，由 NAS 接收需要代理的流量，再连接 Surge 的 SOCKS 服务；不再依赖最初未能通过测试的跨网段 Surge 网关方案。

```
MAIN 192.168.10.0/24（UDM .1，DHCP 池 .100-.199）
├─ Mac mini  192.168.10.4   常开，跑 Surge（仅作代理服务）
└─ NAS       192.168.10.5   常开，跑 WireGuard 服务端 + DNS

DNS：
  客户端 → 192.168.10.5:53（AdGuard Home，去广告）
        → 127.0.0.1:6210（dnsq：国内外分流）
             ├─ 命中国内域名表(109,801 条) → 223.5.5.5
             └─ 其余 → SOCKS5(192.168.10.4:6153) → 1.1.1.1

流量：客户端 → UDM 策略路由（按顺序）
  0. 源=mini  → WAN1                防自环
  1. 源=NAS   → WAN1                防自环
  2. 源=MAIN  → REGION[CN] → WAN1
  3. 源=MAIN  → INTERNET   → WG 隧道
        → 10.66.66.0/24 → NAS
        → iptables REDIRECT(wg0 → 6212)
        → tproxy（Python，SO_ORIGINAL_DST + TLS SNI）
        → Surge SOCKS(192.168.10.4:6153) → 策略组 → 上游出口

  隧道内的公网 UDP 443 → NAS 丢弃，浏览器回退到上述 TCP 路径
  私网目标不受这条 UDP 443 规则影响
```

**这套架构使用 Surge 的代理服务**，不依赖它向其他客户端提供网关或 DHCP。节点名称也不能拿来判断最终出口：后面排查 ChatGPT 时，同一个叫「香港 01」的节点，对 ChatGPT 域名实际用了日本出口，对登录域名却用了新加坡出口。

## 关键实现

### 1. 隧道流量透明转发（tproxy.py）

从隧道进来的包目的地是真实公网 IP，要在 NAS 上"接管"它们并交给 Surge 的 SOCKS。

```bash
# 隧道网段 → 本地 6212，其它照常
iptables -t nat -A PREROUTING -i wg0 -d 192.168.0.0/16 -j RETURN
iptables -t nat -A PREROUTING -i wg0 -d 10.0.0.0/8      -j RETURN
iptables -t nat -A PREROUTING -i wg0 -p tcp -j REDIRECT --to-ports 6212
```

```python
# 取原始目的地（Linux 的 SO_ORIGINAL_DST），再用 SOCKS5 连到 Surge
def orig_dst(s):
    data = s.getsockopt(socket.SOL_IP, 80, 16)
    port = struct.unpack("!H", data[2:4])[0]
    return socket.inet_ntoa(data[4:8]), port
```

每个连接开一条到 Surge 的 SOCKS5，把目的地告诉它，然后双向转发。这里后来补了一步：公网 TCP 443 在建立 SOCKS 连接前读取 TLS ClientHello 的 SNI，能识别域名就用 SOCKS5 的域名地址类型转交，识别不到则保留原 IP。读取过的握手字节会原样转发，不解密 HTTPS；私网目标和其他端口仍按原目的地址处理。

这一步让本机代理与经 NAS 透明转发的客户端都能把域名交给 Surge，避免前者命中域名规则、后者只拿着 IP 落到兜底规则。TLS 不带明文 SNI 或使用 ECH 时，仍不能保证还原真实域名，不能把它当成通用解密或完整 UDP 代理。

### 2. 分流解析器（dnsq.py）

从 `felixonmars/dnsmasq-china-list` 拿 11 万条国内域名，命中就走 `223.5.5.5`，否则走 SOCKS 到 `1.1.1.1`：

```python
def is_cn(name):
    parts = name.split(".")
    for i in range(len(parts)):
        if ".".join(parts[i:]) in CN:
            return True
    return False

resp = via_udp(data) if is_cn(name) else via_socks(data)
```

最初把缓存时间固定成一小时，后来发现不对：缓存键只有域名，A 和 AAAA 会互相覆盖。实测先查 A 再查 AAAA，第二次返回的响应问题区竟然还是 A，经 AdGuard 查询还出现了 `SERVFAIL`。

现在按完整查询内容缓存，仅排除事务 ID，因此查询类型、类别、标志和 EDNS 参数都参与区分。缓存寿命取答案中最小的普通记录 TTL，并设置一小时上限；命中缓存时同步扣减剩余 TTL。不缓存错误、截断或无答案的响应，并检查上游回包的事务 ID 和问题区。

国外 DNS 的这条路径是 **SOCKS5 → DNS over TCP → 1.1.1.1:53**，不是 DoH。

### 3. 端口规划

统一收敛，避免以后新服务乱挤：

| 段 | 用途 |
|---|---|
| 6000–6099 | 面向人的 Web（glance 6001、glances 6002、snitch 6004） |
| 6100–6199 | 媒体/下载（jellyfin 6100、ani-rss 6101、qBittorrent 6102） |
| 6200–6299 | 网络基础设施（AdGuard 6200、dnsq 6210、tproxy 6212、filterhost 6213） |
| 6300–6399 | 监控/运维（预留） |

标准端口不动：53（DNS）、51820（WireGuard）、60022（SSH）、5000/5001（DSM）、5432（PostgreSQL）。

### 4. 目录规范

所有容器数据都进 `/volume1/docker/homelab/`，compose 用**相对路径**，整个目录可以整体搬走或版本管理：

```
homelab/
├── network/
│   ├── network.yaml       ← 唯一入口，docker-compose up -d
│   ├── wireguard/         Dockerfile + entry.sh + wg0.conf
│   ├── adguardhome/       work/ conf/
│   ├── dnsq/              dnsq.py + china-domains.txt
│   └── tproxy/            tproxy.py
├── application/
└── maintenance/
```

## 故障矩阵

| 故障 | 大陆 | 内网 | 国外 |
|---|---|---|---|
| Surge / 节点挂 | ✅ | ✅ | ❌ 被 TCP 转发接管的连接断开 |
| 隧道服务端挂 | ✅ | ✅ | ❌ **回落直连**（UDM 能力所限） |
| NAS 挂 | ⚠️ 域名解析降级 | ✅ | ❌ |
| UDM 挂 | ❌ | ❌ | ❌ |

第一条曾观察到：Surge 节点失效时，百度、淘宝仍正常，被代理接管的连接失败。但后来的 QUIC 问题证明，**TCP 连接失败不等于所有协议都 fail-closed**。这套 Python 转发只接管 TCP；公网 UDP 443 现在单独阻断，其他 UDP 流量仍需独立检查，不能笼统宣称不会直连。

第三条靠 DNS 双活缓解：NAS 和 mini 各跑一份同样的分流解析器，DHCP 同时下发两个地址。

## 后续排障：Codex 能发消息，ChatGPT 却登不上

网络改完以后，其他 Mac 的 Codex 桌面版出现了两种错误：先是 `chatgpt.com/backend-api/codex/responses` 返回 HTML 403，后来登录授权又返回：

```json
{"error":{"code":"unsupported_country_region_territory","message":"Country, region, or territory not supported","type":"request_forbidden"}}
```

最容易误判的是：常开 Mac 正常，别的电脑不正常，于是以为客户端代理没配好。但这套网络本来就不该要求每台客户端单独配置代理，修复应放在 NAS 和 Surge 上。

### 第一层：同一个策略名，不代表同一个出口

先对比常开 Mac 和测试 Mac（`.161`）。最初经 NAS 的请求在 Surge 中全部显示来源 `.5`，这是 NAS 重新建立 SOCKS 连接的结果，不代表这些请求都是 NAS 自己发起的。

补齐 TLS 域名以后，两边可以命中同一组规则，但还要验证上游。对同一个「香港 01」连续测了两轮：

| 域名 | Cloudflare trace 地区 | 公网 IP 的关系 |
|---|---|---|
| `chatgpt.com` | 日本 | IP A |
| `sentinel.openai.com` | 日本 | 同一个 IP A |
| `auth.openai.com` | 新加坡 | 另一个 IP B |

Surge 记录中，三者连接的是同一个代理服务器地址。因此，**出口差异发生在上游代理内部**，可能涉及远端 DNS、按域名分流或解锁转发；没有服务商配置，不能继续断言是哪一种。Cloudflare trace 的 `loc` 也不能代替 OpenAI 自己的地区判定，Ray ID 后缀只是处理请求的节点位置。

最初临时把规则直接指向日本节点，虽然让 Codex 恢复，但没有解决配置一致性。最终改成所有相关域名统一引用可切换的策略组：

```ini
DOMAIN-SUFFIX,chatgpt.com,🧲 OpenAI,extended-matching
DOMAIN-SUFFIX,openai.com,🧲 OpenAI,extended-matching
DOMAIN-SUFFIX,oaistatic.com,🧲 OpenAI,extended-matching
DOMAIN-SUFFIX,oaiusercontent.com,🧲 OpenAI,extended-matching
```

`extended-matching` 让 Surge 同时检查 TLS SNI 和 HTTP Host，规则放在前面。**规则不写死国家或节点**；策略组当前选「日本 01」，三个关键域名实测公网 IP 相同。本机、NAS 显式走 Surge、测试 Mac 经透明转发，也得到相同出口。切换节点后需要重新验证，不能只看节点的名字。

### 第二层：TCP 测试通过，浏览器登录仍可能绕路

到这里，测试 Mac 的真实 Codex 请求已经返回 `OK`，但浏览器登录授权仍然报地区错误。这说明「能发消息」并不能证明「能重新登录」。

继续看 NAS 的接管规则，只有这一条：

```bash
iptables -t nat -A PREROUTING -i wg0 -p tcp -j REDIRECT --to-ports 6212
```

**它没有接管 UDP。** 浏览器可以用 HTTP/3（QUIC，UDP 443），而命令行测试走的是 TCP。隧道中的 UDP 如果没有额外限制，就可能经 NAS 的普通路由直连。NAS 自己不带代理访问测试站点时，实测是大陆出口；它显式连接 Surge 时才是代理出口。

因此在 NAS 加了一条保护：只对从 `wg0` 进来的 UDP 443 生效，私网目的地照常返回，其余丢弃，让浏览器回退到已有的 TCP 代理路径。

```sh
#!/bin/sh
set -eu
chain=WG_QUIC_GUARD
iptables -nL "$chain" >/dev/null 2>&1 || iptables -N "$chain"
for subnet in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
    iptables -C "$chain" -d "$subnet" -j RETURN 2>/dev/null ||
        iptables -A "$chain" -d "$subnet" -j RETURN
done
iptables -C "$chain" -j DROP 2>/dev/null ||
    iptables -A "$chain" -j DROP
iptables -C FORWARD -i wg0 -p udp --dport 443 -j "$chain" 2>/dev/null ||
    iptables -I FORWARD 1 -i wg0 -p udp --dport 443 -j "$chain"
```

一开始尝试 `REJECT --reject-with icmp-port-unreachable`，群晖的 iptables 报 `unknown option "--reject-with"`，脚本在挂入转发规则前退出。换成兼容的 `DROP` 后规则成功加载；代价是浏览器可能等待一段超时再回退 TCP。

加规则后，测试 Mac 重新从 Codex 发起授权，**用户确认登录成功**。这支持 QUIC 绕路是本次登录故障的关键原因，但没有登录前后的抓包或规则命中计数对照，不能说已经逐包证明那次失败一定走了 QUIC。

### 最终落地与验证边界

- NAS 的 `tproxy.py` 保留 TLS 域名；本机和透明转发客户端使用同一个 OpenAI 策略组。
- `dnsq.py` 区分 A / AAAA 等查询，并遵守 TTL；实测混用问题已消失。
- `wireguard/quic-guard.sh` 阻止隧道内公网 UDP 443 绕过 TCP 代理，私网目标放行。
- WireGuard 容器的 `entry.sh` 在 `wg-quick up` 后调用该脚本，规则可重复执行；原文件均保留备份。
- 没有修改客户端代理设置。启动脚本做了语法检查，但没有为了验证持久化而重启整台 NAS。

NAS 的「转发流量」和「自己发起的请求」也要分开看。它不是所有程序自动走代理：需要访问境外服务的容器，应在服务级别配置 HTTP / HTTPS 代理，并按所用客户端库支持的格式设置 `NO_PROXY`，保留内网直连。本次检查的部署文件中，Glance 已有代理，TrendRadar 使用 DeepSeek，没有发现需要新增 OpenAI 代理的服务；这不等于已经检查了每个容器的运行时环境。

这次最值得记住的顺序是：**先验证分流规则，再验证真实出口，最后验证浏览器完整登录流程。** `curl` 不再返回 HTML 403、接口返回 405，或者已登录的 Codex 能回答，都不能单独证明 OAuth 登录已经恢复。授权链接里的 `state`、PKCE 参数和工作区信息也不用放进公开排障记录。

参考：[Surge 域名规则与 extended-matching](https://manual.nssurge.com/rules/domain.html)、[本地与代理端 DNS 解析](https://kb.nssurge.com/surge-knowledge-base/technotes/dns)。

## 小结

这次改造留下了几条具体的检查经验：

- IP 级分流的前提是干净的 DNS，否则分的是假地址；
- 本次测试中，填写 `next_hop` 没有改变转发路径，最终使用 WireGuard 作为策略出口；
- 当前配置下隧道断开会回落直连，不能只凭 kill switch 开关判断断线保护是否生效；
- 网关模式的接管范围需要实测，不能把本次配置下的失败当成产品普遍限制；
- TCP 和 QUIC 必须分别验证，同一策略名也不保证上游出口一致。

这些行为需要在自己的设备和配置上逐项验证。最后落地的架构反而比最初的设想简单——**没有 VLAN、没有网关模式、没有跨网段回程**，一条平坦网络加上两个 Python 小脚本，把"分流"和"代理"两件事干净地分开了。

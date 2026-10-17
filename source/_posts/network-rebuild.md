---
title: 家庭网络改造实录：用 UBNT 策略路由 + WireGuard + Surge 做 IP 级分流
date: 2026-10-18 03:10:00
updated: 2026-10-18 03:10:00
categories:
  - 网络
tags:
  - UniFi
  - WireGuard
  - Surge
  - AdGuard Home
  - Synology
description: 把「按域名代理」换成「按真实 IP 分流」的全过程，包括五个被实测推翻的假设、三次事故复盘，以及最终落地的扁平网络架构。
cover: /images/network-rebuild.svg
---

## 缘起

家里的网络一直是这样：主网段 `192.168.10.0/24`（UBNT 网关），另一个 `192.168.15.0/24` 跑 Surge 网关模式，需要代理的设备连后者。

用久了发现几个问题：

- Wi-Fi 一旦连到 Surge 那套，所有流量（包括大陆）都先进 Surge，由它按域名裁决，链路多一跳；
- DNS 被 Surge 的 fake-IP 接管，排查问题时看到的全是 `198.18.x.x`；
- 想把"大陆直连、其余走代理"交给 UBNT 用**真实 IP** 判断，而不是由客户端 DNS 决定。

于是有了这次改造。目标定得很具体：

1. 日常 Wi-Fi（`1401`）回到主网段，客户端网关是 UBNT；
2. UBNT 只做普通路由，不把内网流量送进代理通道；
3. UBNT 按**真实目的 IP** 分流：大陆优先 WAN，其余送验证过的 VPN 出口；
4. 只对客户端来源应用代理策略，代理节点自身的连接必须走普通 WAN；
5. DNS 返回真实 IP，保留家庭域名；
6. 未验证 IPv6 之前不宣称同策略；
7. 代理通道失效时，内网和大陆 IP 仍正常。

<!-- more -->

## 五个被实测推翻的假设

这部分是整篇文章最有价值的地方——每一条我都以为是"常识"，结果都不成立。

### 1. 「公共 DNS 返回的 IP 可以直接用来分流」

不成立。同一个域名问两个解析器：

| 域名 | `223.5.5.5` | 经代理的 DoH |
|---|---|---|
| www.google.com | 空（超时） | `142.251.155.119` |
| www.youtube.com | `104.244.42.197`（推特 IP） | `142.251.154.4` |
| www.baidu.com | 正确的国内 IP | — |

**DNS 污染意味着"IP 级分流"的前提是拿到真实 IP**，否则分流做得再准，连的也是个假地址。这一步不解决，后面全是白搭。

### 2. 「可以把流量路由给 Surge」

不成立。Surge 网关 `.161` 对非它 DHCP 下发的客户端是封闭的：

```
surge = 192.168.15.161
ip route add 34.117.59.81 via 192.168.15.161   → TCP 超时
默认网关临时改成 .161                          → 全部出网超时
端口 53/80/443/6152/6153/6170/9090             → 全部 closed
```

它只服务自己 DHCP 出来的客户端（靠 fake-IP DNS 识别），**不是一台通用路由器**。这条推翻了整个第一版设计：隧道端点必须本身就是 Surge 的客户端。

### 3. 「UBNT 的 kill switch 能兜底」

不成立。三种验证方式都失败：

- 杀掉隧道服务端进程；
- 在 UDM 上把客户端 `enabled: false`；
- 对比 UI 创建的规则与 API 创建的规则（字段完全一致，无隐藏开关）。

三种情况下，隧道失效后国外流量都**回落直连**。这个字段在 API 里能读能写，但内核层面没有对应的丢包规则。

### 4. 「策略路由的 next_hop 可以指向局域网机器」

不成立。填一个 IP 进去，API 返回 201，但转发行为完全不变；填黑洞地址 `192.0.2.1` 也一样——包照常从 WAN 出去。

### 5. 「改完 DHCP 的 DNS 就会生效」

不成立。UDM 的 `rest/networkconf` 里有个 `dhcpd_dns_enabled` 开关，**关着的时候，无论 `dhcpd_dns_1` 填什么都不会下发**，客户端永远拿到网关自己（`192.168.10.1`）。

这个坑卡了很久——设备重连了 Wi-Fi 还是旧 DNS，一度以为是 macOS 缓存。

## 最终架构

放弃 VLAN，全部设备在 `192.168.10.0/24`，因为经过上面这些验证，"把某个网段交给 Surge" 这条路本身就不通。

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
        → tproxy（Python，SO_ORIGINAL_DST）
        → Surge SOCKS(192.168.10.4:6153) → 节点 → 出国
```

**Surge 只作为代理服务存在**：不开网关模式、不发 DHCP、不占网段。实测 `curl --socks5 192.168.10.4:6153 https://ipinfo.io/ip` 直接返回香港 IP——这就够了。

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

每个连接开一条到 Surge 的 SOCKS5，把目的地告诉它，然后双向转发。

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

缓存 TTL 从 300 秒提到 3600 秒——GitHub 这种一次打开几十个子域名的站点，冷查询走代理 DoH 每个要 100ms，缓存后立竿见影。

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
| Surge / 节点挂 | ✅ | ✅ | ❌ 断（不回落到直连） |
| 隧道服务端挂 | ✅ | ✅ | ❌ **回落直连**（UDM 能力所限） |
| NAS 挂 | ⚠️ 域名解析降级 | ✅ | ❌ |
| UDM 挂 | ❌ | ❌ | ❌ |

第一条已经实测过：Surge 节点全部失效的那十几分钟，百度、淘宝一直正常，国外全断，**没有一条流量偷偷走直连**。

第三条靠 DNS 双活缓解：NAS 和 mini 各跑一份同样的分流解析器，DHCP 同时下发两个地址。

## 三次事故复盘

### 事故一：按网段匹配的测试规则把全网炸了

为了验证 fail-closed，我建了一条"源 = 整个 SURGE 网段 → 进隧道"的临时规则。

问题在于：**那个网段里装着 Surge 网关自己**。规则一匹配，Surge 的流量也被送进隧道，而隧道出口又经过 Surge——自环，整条代理链路瞬间崩塌，全家断网。

> 教训：**测试规则只能针对单台设备，绝不能按"含有基础设施的网段"匹配**。基础设施（代理网关、隧道服务端）必须显式排除，且优先级最高。

### 事故二：Surge 配置被覆盖成空文件

写了个每天自动同步订阅的脚本，节点数检查是这么写的：

```bash
N=$(grep -c '...' "$TMP" 2>/dev/null || echo 0)
```

下载失败时 `grep -c` 输出 `0` 且退出码非零，`|| echo 0` 又追加了一个 `0`，于是 `N` 变成 `"0\n0"`，`[ "$N" -lt 10 ]` 报错而不是拦截，空内容直接覆盖了配置——225 个节点变成 0。

> 教训：**任何"下载 → 覆盖"的脚本都必须有大小/内容双重校验，且保留 lastgood 副本**。

### 事故三：订阅方给了脱敏配置

某次拿到的配置里，225 个节点的 host 全是字面量 `masked`、端口 `1234`、密码 `<masked>`。于是所有节点连接失败，而 UI 上只显示"连接失败"，不告诉你是为什么。

> 教训：**节点全挂时，先看配置文件里的 host 是不是真地址**，比逐个测节点快得多。

## 小结

回头看，这次改造真正的难点不是配置，而是**几个"想当然"被逐个证伪**：

- IP 级分流的前提是干净的 DNS，否则分的是假地址；
- UBNT 的"VPN 出口"只能给 VPN 客户端用，不能指给局域网设备；
- kill switch 是装饰性的；
- 代理网关只服务它自己的 DHCP 客户端。

这些东西文档里不会写，只有拿真机一条条试才知道。最后落地的架构反而比最初的设想简单——**没有 VLAN、没有网关模式、没有跨网段回程**，一条平坦网络加上两个 Python 小脚本，把"分流"和"代理"两件事干净地分开了。

至于性能：宽带本身只跑出 350–450 Mbps（套餐号称千兆，还在和运营商扯），代理链路峰值 200 Mbps，日常足够。

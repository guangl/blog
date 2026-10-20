---
title: 家庭网络改造实录：用 UBNT 策略路由 + WireGuard + Surge 做 IP 级分流
date: 2026-10-18 03:10:00
updated: 2026-10-20 20:24:51
categories:
  - 网络
tags:
  - UniFi
  - WireGuard
  - Surge
  - AdGuard Home
  - Synology
description: 从双网段与 Surge 网关模式改为 UBNT IP 级分流，记录改造动机、收益与限制，以及 NAS 五个容器、WireGuard、DNS 和透明转发的配置。
cover: /images/network-rebuild.svg
article:
  ai_label: generated
---

## 一、改造背景

### 1. 原来的双网段网络

改造前，家里同时使用两个网段：`192.168.10.0/24` 是以 UBNT 为网关的主网，另一个 `192.168.15.0/24` 使用 Surge 网关模式。需要代理的设备连接后者，由 Surge 接收流量并按规则选择直连或代理。

```text
原来的使用方式：
设备连接主网 → UBNT → 普通出网
设备连接 Surge 所在网络 → Surge 网关 → 直连 / 上游代理
```

这套方式能满足代理需求，使用上的区别也很直观：连哪个网络，就使用哪套出网方式。但连接 Surge 网络的设备，访问大陆服务时也要先经过 Surge，再由它判断是否直连。是否需要代理，首先变成了设备该连接哪个网络的问题。

另外，Surge 的 fake-IP DNS 会向客户端返回 `198.18.x.x` 一类虚拟地址。它便于 Surge 按域名处理连接，但 UBNT 看到的目的地址不再是网站的真实公网 IP，不适合直接拿来做大陆与境外的 IP 分流。排查某个连接时，也需要再从虚拟地址找回对应域名。

### 2. 改造目标

这次希望把日常使用收敛到一套网络：设备连接家里的 Wi-Fi 后，内网访问留在内网，大陆公网 IP 直接从 UBNT 出网，其余公网 IP 再进入代理链路。客户端继续使用 DHCP，不需要根据访问需求切换网络或单独设置代理。

为了做到这一点，需要调整两个环节：**DNS 向客户端返回真实 IP，UBNT 根据目的 IP 选择出口**。Surge 继续负责代理节点和域名规则，日常客户端的默认网关则统一为 UBNT。

最终的分工是：UBNT 做网关和 IP 分流，群晖 NAS 接收 WireGuard 隧道流量并提供 DNS，Mac mini 上的 Surge 提供 SOCKS5 代理。NAS 网络层配置了 **5 个 Docker 容器**，由一份 Compose 文件管理；Surge 是 Mac mini 上的原生应用，不计入这五个容器。

<!-- more -->

## 二、方案设计

### 1. 设备分工与流量路径

| 设备 | 地址 | 承担的工作 |
|---|---|---|
| UBNT / UDM | `192.168.10.1` | 默认网关、DHCP、按目的 IP 分流、WireGuard 客户端 |
| Mac mini | `192.168.10.4` | 常开运行 Surge，通过 `6153` 提供 SOCKS5 代理 |
| 群晖 NAS | `192.168.10.5` | 运行五个网络容器，提供 DNS、WireGuard 服务端和 TCP 透明转发 |
| 日常客户端 | DHCP 分配 | 连接主网段，通过 UBNT 访问内网、大陆和境外服务 |

主网段的 DHCP 地址池为 `.100–.199`。Mac mini 和 NAS 使用固定地址，方便路由规则和容器配置引用。

这里用到的技术各管一段：**UBNT 策略路由**判断流量走 WAN 还是隧道；**WireGuard**把选中的流量送到 NAS；**iptables + Python**把隧道中的 TCP 连接转成 SOCKS5 连接；**Surge**选择代理节点。DNS 则由 **AdGuard Home + 自写的 dnsq 解析器**共同处理。

两条主要路径如下：

```text
DNS 查询：
客户端 → NAS AdGuard Home :53 → dnsq 127.0.0.1:6210
                               ├─ 国内域名 → 223.5.5.5
                               └─ 其余域名 → Surge SOCKS5 → 1.1.1.1:53（TCP）

访问流量：
客户端 → UBNT
         ├─ 内网目的地址 → 内网路由
         ├─ 大陆公网 IP → WAN1
         └─ 其余公网 IP → WireGuard → NAS → TCP 透明转发
                                          → Surge SOCKS5 → 上游代理出口
```

DNS 返回真实 IP，UBNT 根据这个 IP 选择路径。Surge 收到转发连接后，仍可以根据可识别的域名匹配自己的代理规则。

### 2. NAS 上的五个容器

网络服务写在 `network/network.yaml`，Compose 项目名为 `homelab_network`：

| 容器 | 实现 | 端口 | 用途 |
|---|---|---|---|
| `wg-home` | 自建 Alpine 镜像，安装 `wireguard-go`、`wg-quick` 和 iptables | UDP `51820` | WireGuard 服务端，接收 UBNT 发来的流量 |
| `tproxy` | `python:3.11-slim-bookworm`，运行 `tproxy.py` | TCP `6212` | 取得原始目的地址，将 TCP 连接转发到 Surge SOCKS5 |
| `dnsq` | 同上，运行 `dnsq.py` | `127.0.0.1:6210` | 按国内域名表选择 DNS 上游并缓存响应 |
| `filterhost` | 同上，运行 Python HTTP 静态服务 | `127.0.0.1:6213` | 提供本地过滤列表，供 AdGuard Home 读取 |
| `adguardhome` | AdGuard Home 镜像 | DNS `53`，管理界面 `6200` | 接收客户端 DNS 查询、执行过滤，再交给 dnsq |

五个服务都使用 `network_mode: host` 和 `restart: unless-stopped`。host 网络让 WireGuard 接口、DNS 监听和透明转发直接使用 NAS 的网络环境；`wg-home` 与 `tproxy` 还配置了 `privileged: true`。dnsq 和过滤列表服务只绑定回环地址，客户端访问的是 AdGuard Home。

Compose 中分别为这五个服务配置了 `128M`、`128M`、`256M`、`64M`、`512M` 的内存限额。这是配置值，不是实测占用。

### 3. 与原方案相比的变化

| 方面 | 原来的方式 | 改造后的方式 |
|---|---|---|
| 客户端使用 | 根据是否需要代理选择网络 | 日常设备统一连接主网，由网关选择路径 |
| 大陆流量 | 连接 Surge 网络时，先交给 Surge 判断直连 | 命中大陆 IP 规则后直接走 UBNT 的 WAN1 |
| DNS 与路由 | Surge 使用 fake-IP，域名与虚拟地址由它维护 | DNS 返回真实 IP，UBNT 可以按目的 IP 分流 |
| 内网访问 | 同时维护主网与 Surge 所在的另一个网段 | 日常设备统一放在 `192.168.10.0/24`，内网通信保留本地路由 |
| 配置维护 | 网关接管、DNS 和代理规则集中在 Surge 一侧 | 路由在 UBNT、DNS 和转发在 NAS、代理出口在 Surge，按职责维护 |

最直接的好处是减少客户端操作，并让大陆流量在 UBNT 就选好直连路径。真实 IP、DNS 查询记录和代理连接记录也让每一段路径更容易核对。这些是使用方式和流量路径的变化，不能据此宣称整网速度提升；本文没有改造前后同条件的吞吐和延迟对比。

## 三、配置与部署

### 1. 配置 Surge 的代理入口

Mac mini 固定为 `192.168.10.4`，Surge 向局域网提供 `6153` 端口的 SOCKS5 服务。NAS 上的 dnsq 和 tproxy 都连接这个地址。

在这套架构里，Surge 承担代理服务，客户端的默认网关仍是 UBNT。Mac mini 自身的出网流量在 UBNT 上固定走 WAN1，避免 Surge 连接上游节点时又被送回 WireGuard。

需要统一出口的域名放入同一个策略组。例如 OpenAI 相关规则使用同一个可切换的组：

```ini
DOMAIN-SUFFIX,chatgpt.com,🧲 OpenAI,extended-matching
DOMAIN-SUFFIX,openai.com,🧲 OpenAI,extended-matching
DOMAIN-SUFFIX,oaistatic.com,🧲 OpenAI,extended-matching
DOMAIN-SUFFIX,oaiusercontent.com,🧲 OpenAI,extended-matching
```

这些规则放在通用规则前面，具体节点在策略组里选择。`extended-matching` 配合 TLS SNI 和 HTTP Host 匹配域名；节点切换后，再检查相关域名的实际出口是否一致。

### 2. 在 NAS 上建立 WireGuard 隧道

这台群晖的 DSM 内核没有 WireGuard 模块，因此 `wg-home` 使用用户态的 `wireguard-go`。镜像基于 Alpine，安装 WireGuard 工具、`wg-quick`、`wireguard-go`、iptables 和单独的 `iptables-legacy` 包。DSM 上使用 legacy 后端；启动脚本也确保 `wg-quick` 的 iptables 钩子指向该后端。

服务端配置放在 `network/wireguard/wg0.conf`，容器内挂载到 `/config`。文件包含私钥和 peer 信息，不提交到仓库。UBNT 作为 WireGuard 客户端连接 NAS 的 UDP `51820`，隧道网段使用 `10.66.66.0/24`。

宿主机先由 `/usr/local/etc/rc.d/wg-host-start.sh` 加载 `tun.ko`、创建 `/dev/net/tun`，再等待 Docker 启动目标容器。容器启动脚本依次完成：

1. 开启 `net.ipv4.ip_forward`，确认 legacy 后端可用。
2. 用 `wg-quick` 启动 `wg0`，通过 `wireguard-go` 提供用户态实现。
3. 调用统一的 `firewall.sh`，建立 TCP 重定向、QUIC 限制、NAT 和转发规则。
4. 只有接口和规则都成功才报告就绪；每 60 秒检查并补回缺失规则，失败退出，由重启策略处理。

Compose 的 `wg show wg0` 健康检查只能判断接口存在，不能单独证明防火墙规则和代理上游可用。整机重启恢复及客户端测试记录见第五节。

### 3. 把隧道 TCP 流量交给 Surge

`tproxy` 容器运行一个 Python 转发程序。这里的容器名称叫 tproxy，实际接管方式是 **iptables REDIRECT + SO_ORIGINAL_DST**。

从 `wg0` 进入的 TCP 流量被重定向到本机 `6212`。下面是接管规则的核心片段，私网绕过规则放在 TCP 重定向前：

```bash
iptables -t nat -A PREROUTING -i wg0 -d 192.168.0.0/16 -j RETURN
iptables -t nat -A PREROUTING -i wg0 -d 10.0.0.0/8 -j RETURN
iptables -t nat -A PREROUTING -i wg0 -p tcp -j REDIRECT --to-ports 6212
```

Python 程序通过 Linux 的 `SO_ORIGINAL_DST` 取回原始目的 IP 和端口，再向 `192.168.10.4:6153` 建立 SOCKS5 连接，双向转发数据：

```python
def orig_dst(s):
    data = s.getsockopt(socket.SOL_IP, 80, 16)
    port = struct.unpack("!H", data[2:4])[0]
    return socket.inet_ntoa(data[4:8]), port
```

对公网 TCP 443，程序先读取 TLS ClientHello。能识别 SNI 时，用 SOCKS5 的域名地址类型把目标交给 Surge；识别不到时保留原 IP。握手字节随后原样转发，不解密 HTTPS。这样，Surge 可以对可识别的域名继续应用规则。

这个转发程序只处理 TCP。WireGuard 启动时会调用统一的 `firewall.sh`（旧 `quic-guard.sh` 保留为兼容入口），丢弃从 `wg0` 进入、发往公网的 UDP 443，让浏览器回退到 TCP；`10.0.0.0/8`、`172.16.0.0/12` 和 `192.168.0.0/16` 私网目的地放行。它没有实现通用 UDP 代理，也不能保证识别使用 ECH 的真实域名。

### 4. 配置 DNS 分流与过滤

客户端先查询 NAS 上的 AdGuard Home。AdGuard Home 负责过滤和查询记录，再把普通上游查询交给 `127.0.0.1:6210` 的 dnsq。

```text
客户端 → 192.168.10.5:53
       → AdGuard Home 过滤
       → 127.0.0.1:6210
            ├─ 命中国内域名表 → UDP 查询 223.5.5.5:53
            └─ 未命中 → SOCKS5 192.168.10.4:6153
                      → TCP 查询 1.1.1.1:53
```

dnsq 使用从 `felixonmars/dnsmasq-china-list` 整理的约 11 万条国内域名，并逐级匹配域名后缀。境外查询通过 Surge 建立到远端 DNS 的 TCP 连接，这条路径使用 DNS over TCP。

缓存按完整查询内容区分，仅排除事务 ID，因此 A、AAAA、查询类别和 EDNS 参数不会混用。缓存寿命取答案中最小的普通记录 TTL，上限一小时；返回缓存时扣减已过去的时间，不缓存错误、截断或无答案响应。

`filterhost` 把 AdGuard 的本地过滤列表目录挂载到 `/srv`，通过 `127.0.0.1:6213` 提供静态 HTTP 服务。它只是列表来源，不参与 DNS 转发。

UBNT 的 DHCP 配置需要启用自定义 DNS，并下发 NAS 地址。修改后在客户端确认实际收到的 DNS 地址。Mac mini 上还运行一份独立备用分流解析器，由 DHCP 一并下发 `.5` 和 `.4`；它属于 Mac 侧服务，不在 NAS 的五个容器里。两端缓存均按查询内容区分，Apple 联网检测域名使用国内公共 DNS；mini 的国内解析不依赖 NAS，故障切换经过实际离线窗口验证。

### 5. 配置 UBNT 的策略顺序

UBNT 负责按真实目的 IP 选择出口。策略顺序如下：

| 顺序 | 来源 | 目的范围 | 出口 |
|---|---|---|---|
| 1 | Mac mini `192.168.10.4` | 公网 | WAN1 |
| 2 | NAS `192.168.10.5` | 公网 | WAN1 |
| 3 | MAIN 客户端 | `REGION[CN]` 大陆公网 IP | WAN1 |
| 4 | MAIN 客户端 | 其余互联网流量 | WireGuard 客户端 |

内网通信保留本地路由，不送进代理隧道。Mac mini 和 NAS 的直连规则放在前面，避免代理服务和 DNS 服务自己发起的连接再次进入代理链路。

于是，访问大陆 IP 的客户端直接从 UBNT 出网；访问其他公网 IP 时，由 UBNT 送进 WireGuard，NAS 接管 TCP，再交给 Surge。需要代理的 NAS 容器自身请求，则单独设置 HTTP / HTTPS 代理和适当的 `NO_PROXY`。

### 6. 整理目录并启动服务

NAS 上以 `/volume1/docker/homelab/` 为根目录，Compose 中的挂载使用相对路径：

```text
homelab/
├── .env
├── network/
│   ├── network.yaml
│   ├── wireguard/
│   │   ├── Dockerfile
│   │   ├── entry.sh
│   │   ├── firewall.sh
│   │   ├── quic-guard.sh
│   │   └── wg0.conf          # 含私钥，不入库
│   ├── tproxy/
│   │   └── tproxy.py
│   ├── dnsq/
│   │   ├── dnsq.py
│   │   └── china-domains.txt
│   └── adguardhome/
│       ├── conf/
│       └── work/filters/
├── application/
└── maintenance/
```

准备好 WireGuard peer、AdGuard 配置和域名列表后，在根目录执行：

```bash
docker compose --env-file .env -f network/network.yaml up -d --build
docker compose --env-file .env -f network/network.yaml ps
docker compose --env-file .env -f network/network.yaml logs --tail=100
```

第一条命令构建 WireGuard 镜像并启动五个服务，后两条查看状态和日志。Surge 的 SOCKS5 服务需要先就绪；NAS 服务完成检查后，再让日常客户端使用新的 DNS 和路由策略。

## 四、验证与运行边界

### 1. 按链路逐项验证

按数据经过的顺序验证，方便定位到具体服务：

1. **DNS**：向 NAS 查询国内外域名，分别检查 A 和 AAAA 响应，并在 AdGuard 查询记录中确认上游。
2. **隧道**：查看 NAS 和 UBNT 的 WireGuard 握手及收发计数，确认客户端流量进入隧道。
3. **分流**：分别访问内网、大陆和境外站点，检查 UBNT 出口与 Surge 连接记录。
4. **代理出口**：对需要统一出口的域名逐一检查公网 IP，再测试浏览器完整登录流程。
5. **故障行为**：分别停止代理和隧道，检查大陆、内网和境外连接的实际表现。

当前配置下，WireGuard 断开后曾观察到境外流量回落直连，不能把 UBNT 的 kill switch 开关当作断线保护已经生效的证据。TCP 接管和公网 UDP 443 限制也不覆盖所有协议，其他 UDP 和 IPv6 仍需单独验证。10 月 20 日已通过整台 NAS 重启验证 TUN、隧道和服务自动恢复；另用重启离线窗口验证国内访问，见第五节。

### 2. 运行成本与已知限制

客户端操作减少了，服务端需要维护的东西却增加了。境外 TCP 访问依赖 UBNT、NAS 的 WireGuard 与转发程序、Mac mini 的 Surge，以及上游节点；DNS 还依赖 AdGuard Home 和 dnsq。NAS 和 Mac mini 都需要常开，五个容器、两个 Python 程序和路由规则也需要一起维护。

这套实现还有几个明确的边界：

- **境外链路更长。** 流量经过 WireGuard、NAS 用户态转发和 Surge，增加了处理环节；这台群晖还使用用户态 WireGuard，实际性能需要单独测量。
- **协议覆盖不完整。** Python 转发程序只接管 TCP；公网 UDP 443 通过丢弃促使浏览器回退，其他 UDP 没有因此自动获得代理能力。IPv6 尚未验证同样的分流策略。
- **断线保护尚不完整。** 当前配置下曾观察到 WireGuard 断开后境外流量回落直连，不能依赖 kill switch 开关保证阻断。
- **IP 地区与域名需求不总是一致。** UBNT 按 IP 地区决定是否进隧道，Surge 的域名规则只作用于交给它的连接；有特殊出口需求的服务，仍需检查实际路径和上游出口。
- **统一网段不提供额外隔离。** 日常设备放在同一个网段，便于使用；如果以后要隔离访客或 IoT 设备，仍需要另行规划网络和访问规则。

因此，这次改造更适合描述为把分流和代理服务集中管理。它改善了日常使用和职责划分，同时增加了服务之间的依赖。后续维护需要同时考虑这些依赖和边界。

## 五、重启故障与 NAS 离线降级修复（2026-10-20）

2026 年 10 月 20 日，家里其他设备又出现「国内正常，境外打不开」。常开 mini 自己却能访问 Google，很容易再次怀疑客户端设置。但这次把链路拆开测，问题很快缩到了 NAS：

| 测试路径 | 修复前结果 |
|---|---|
| 测试 Mac `.161` → 百度 | HTTP 200 |
| 测试 Mac `.161` → Google，使用默认路由 | TCP 连接超时 |
| 测试 Mac `.161` → mini SOCKS `6153` → Google | HTTP 200 |
| NAS → mini SOCKS `6153` → Google | HTTP 200 |
| 测试 Mac 对 Google IP 做路由跟踪 | 前两跳为 UDM `.1`、隧道地址 `10.66.66.1` |

所以 Surge 的节点和 SOCKS 服务没有坏，客户端也不需要重新配置代理。能走到隧道地址，只能证明隧道路径可达，不能证明 NAS 已把 TCP 交给 tproxy。

### 真正的问题：防火墙后端不兼容，启动脚本却报成功

NAS 当时的运行时间显示它在凌晨约 02:19 重启过。容器启动日志里反复出现：

```text
iptables v1.8.13 (nf_tables): Could not fetch rule set generation id: Invalid argument
[wg] quic-guard 应用失败（继续启动）
[wg] WireGuard 已就绪（wg0，出口 bond0）
```

WireGuard 使用 `wireguard-go` 的回退是这台 DSM 的既定方案；这里直接失败的是 iptables 的 nft 后端。旧脚本只有 `set -u`，几条防火墙命令失败后仍继续，最后还打印「已就绪」。`wg show` 能成功的健康检查也检查不到透明转发是否存在。

宿主机运行 `iptables -t nat -nvL PREROUTING` 先报找不到链；容器默认 `iptables` 则报 nft 错误。这两个输出都不能直接拿来判断 legacy 表是否存在。安装单独的 `iptables-legacy` 包后，终于看到了实际的 legacy NAT 表：Docker 规则仍在，但 **PREROUTING 是空的**，没有 `wg0 → 6212` 的重定向。

这次证据支持的结论是：重启后当前生效的透明转发规则缺失，同时启动脚本无法用当前默认后端恢复规则。没有保存重启前的完整规则快照，因此不把所有变化都归因于重启本身。

### 先恢复，再固定启动流程

临时恢复采用独立链 `WG_TPROXY`：

```text
PREROUTING: -i wg0 -p tcp → WG_TPROXY
WG_TPROXY:
  10.0.0.0/8、172.16.0.0/12、192.168.0.0/16 → RETURN
  其余 TCP → REDIRECT --to-ports 6212
```

只改隧道入口，不清空 NAT 表，不碰 Docker 已有规则。加回这组规则后，测试 Mac 使用默认网络访问百度、Google、YouTube 和 ChatGPT 的 `/cdn-cgi/trace` 全部返回 HTTP 200。这证明 TCP 透明转发恢复；不等于已经验证浏览器 QUIC 路径或完整 OAuth 登录。

持久化修复包放在 NAS 的 `network/wg-fix-20261020/`，由 `deploy.sh` 部署到 `network/wireguard/`。改动包含：

- Dockerfile 明确安装 `iptables-legacy`，在 PATH 前部提供指向 legacy 的 `iptables`，使 `wg-quick` 的钩子也使用同一后端。
- 新增 `firewall.sh`，统一管理透明 TCP 重定向、隧道 NAT、原有转发放行及公网 UDP 443 防绕路规则。使用 `-C` 检查后再添加，重复执行不堆叠规则。
- QUIC 拦截放在 FORWARD 的首条，先于已有的 `wg0 ACCEPT`；私网目的地仍返回原有转发流程。否则规则虽然存在，也可能永远命不中。
- `entry.sh` 在接口与规则都成功后才报告就绪；每 60 秒检查接口并补回缺失规则，修复失败就退出，交给容器重启策略处理。
- 旧 `quic-guard.sh` 改为调用统一规则脚本，避免维护两份实现。

部署脚本先备份旧文件和 legacy 规则，构建候选镜像成功后再替换，只重建 `wg-home`，不重启 NAS 或其他业务容器。它不会自动清空或恢复整张防火墙表。

**验证状态：** 管理员已执行部署，NAS 上已落地新 Dockerfile、启动脚本、统一规则脚本及备份（`backup-20261020-070816`）。部署后从另一台 Mac `.161` 使用默认网络复测，百度、Google、YouTube 和 ChatGPT 的 `/cdn-cgi/trace` 均返回 HTTP 200；ChatGPT trace 显示 `loc=JP`、HTTP/2、TLS 1.3。这支持部署后 TCP 路径仍然正常。管理员随后执行了连续两次规则应用命令，提供的日志末尾显示 `WireGuard 与透明转发、QUIC 规则已就绪（legacy）`；`WG_QUIC_GUARD` 显示 1 个引用，三个私网放行规则及一条 DROP，DROP 已命中 6 个包、7498 字节。这证明新容器完成了接口与规则初始化，并且 QUIC 保护已有实际命中。回传内容未包含完整 PREROUTING/FORWARD 列表，因此不把所有链的无重复性写成已逐条核验。此阶段尚未重启整台 NAS；随后完成的重启测试见下一节。完整浏览器登录没有在本轮重测。

### 整机重启测试又暴露了一层：宿主机 TUN 没有持久化

随后实际重启整台 NAS。SSH 曾离线，恢复后的 boot ID 与之前不同，运行时间也从约五小时归零，确认经历了整机重启。DNS、dnsq 和 tproxy 陆续自动恢复，但 WireGuard 的 UDP 51820 没有出现；测试 Mac 访问 Google 再次超时。

继续检查发现：`/dev/net` 整个目录不存在，`/proc/modules` 中没有 `tun`，而 NAS 自带 `/lib/modules/tun.ko` 文件。容器内脚本能够恢复 iptables，并不代表它可以恢复宿主机缺失的 TUN 前置条件。

补充修复包新增 `wg-host-start.sh`，由管理员安装到 DSM 的 `/usr/local/etc/rc.d/`：先加载宿主机自带的 `tun.ko`，再以设备号 `10:200` 创建 `/dev/net/tun`；后台等待 Docker 和目标容器可用，再启动 `wg-home` 并检查接口与规则。等待最多十分钟，成功和超时均写入系统日志。旧的 `wg-redirect.sh` 开机脚本备份停用，防火墙恢复统一交给容器，避免宿主机与容器两处重复维护。

**当前验证状态：** 管理员已安装补充启动钩子。执行后实测 `tun` 模块加载成功，`/dev/net/tun` 为 `10:200` 字符设备，WireGuard 的 UDP 51820 恢复监听。测试 Mac `.161` 经默认网络访问百度、Google、YouTube 和 ChatGPT trace 全部 HTTP 200，ChatGPT trace 为 JP、HTTP/2、TLS 1.3。这证明脚本在当前系统上能恢复完整链路；随后进行了第二次整机重启，boot ID 再次变化。开机约两分钟时，TUN 模块、`10:200` 设备、WireGuard UDP 51820、tproxy TCP 6212、dnsq UDP 6210 和 DNS 53 端口均自动恢复，没有手动启动服务，验证了开机钩子实际执行。第二轮测试中，测试 Mac 的 DHCP 地址已由 `.161` 变成 `.108`。确认新地址后，实测默认网关仍为 UDM `192.168.10.1`，未设置单独代理，百度、Google、YouTube 和 ChatGPT trace 均 HTTP 200，耗时约 0.13、0.31、0.49、0.48 秒；ChatGPT trace 为 JP、HTTP/2、TLS 1.3。至此，补充 TUN 启动钩子后的整机重启、服务自动恢复及客户端默认网络 TCP 访问验证通过。OpenAI 策略组保留原有日本节点选择，这不是默认香港策略被重启改动；完整浏览器 OAuth 登录仍未在此轮重测。此前容器状态为 `Exited (137)`，这个退出码本身不能证明是 OOM，也不能单独证明容器启动失败原因。

### NAS 离线时国内仍可用：备用 DNS 也要实测

重启恢复不等于 NAS 离线时国内上网可用。用户随后反馈，NAS 停机时 iPhone 在 `1401` 显示「无互联网连接」，因此补做故障降级检查。

先在测试 Mac 验证百度的国内 IP 路径：首跳为 UDM `.1`，后续进入运营商地址，HTTPS 返回 200，未看到它经 WireGuard 的第二跳。再查备用 DNS `.4`，却发现 `captive.apple.com` 的 A 查询收到 TYPE65 问题区，`dig` 报 `Question section mismatch` 并超时。Mac 上的 dnsq 仍是按域名缓存的旧版，NAS 修复过的查询类型隔离并没有同步到它。旧 `dns-ha` 脚本还引用废弃的 `.15` 网段，而且当前未加载。

本次把 mini 的 dnsq 缓存改为按完整查询区分、校验上游问题区并遵守 TTL；Apple 联网检测域名使用公共 DNS，避免依赖 NAS 或代理上游。部署前先在临时端口测试，随后管理员安装正式版本、重启 dnsq，并备份停用旧的 DNS 切换任务。正式 `.4:53` 的 A、AAAA、TYPE65 混合查询通过，测试 Mac 的 Apple 联网检测页返回 `Success`。

客户端此时仍拿到 NAS `.5` 和 mini `.4` 两个 DNS。这只能证明备用服务当前可用，不能证明手机会及时故障切换。用户选择再次重启 NAS 来提供离线窗口，避免关机后无法远程开机。在 NAS DNS 已超时、随后 SSH 也完全无法连接时，测试 Mac `.108` 使用默认网络访问京东、淘宝、哔哩哔哩和工行官网全部 HTTP 200，耗时约 0.09–0.19 秒；用户同时确认连接 `1401` 的手机国内 App 可以使用。这验证了本轮 NAS 离线窗口内国内上网可用，但没有测试无限期停机或每一种国内 App。

仍有一项联网检测细节：停机前 NAS 对 `captive.apple.com` 返回 `17.253.199.x`，Mac 备用 DNS 返回国内 CDN 地址。客户端用先前的系统解析结果访问检测页超时，显式指定备用 DNS 返回的国内地址则立即得到 HTTP 200 和 `Success`。因此国内 App 能用，不等于 iOS 的提示一定即时消失。NAS 端随后也加入相同的检测域名国内解析规则。安装时 dnsq 容器尚未随 NAS 启动，脚本在文件更新后报“容器未运行”；等待容器自动启动后，新规则已生效。再次分别查询 `.5` 和 `.4`，均得到国内 CDN 地址；按各自返回的地址请求检测页，均为 HTTP 200 和 `Success`。安装脚本也补上先启动 dnsq 再检查的步骤，避免同类时序报错。客户端可能仍保留先前的海外地址缓存，系统直接访问曾显示旧 IP，因此需要等待 TTL 或重新连接后复核手机提示；不把新 DNS 回答等同于所有客户端缓存已清除。手机本次回报仅为“可以使用”，不据此声称“无互联网连接”提示已消失。

### 最终配置与验收结果（2026-10-20）

这次最后补齐的是两个目标：**NAS 重启后代理链路自动恢复；NAS 离线时国内仍能正常上网。** 前者依赖宿主机 TUN 初始化和容器防火墙恢复，后者依赖 UDM 国内直连和独立于 NAS 的备用 DNS。

| 问题 | 最终处理 | 验证结果 |
|---|---|---|
| nft 后端与当前 DSM 不兼容 | 镜像安装 legacy，并让 wg-quick 的 iptables 钩子使用同一后端 | 新容器日志显示 legacy 规则就绪 |
| TCP 重定向未恢复 | firewall.sh 统一管理 WG_TPROXY，启动及每 60 秒检查补回 | 默认网络访问 Google、YouTube、ChatGPT trace 为 200 |
| QUIC 绕过 TCP 接管 | 私网放行，公网 UDP 443 在通用 ACCEPT 前丢弃 | DROP 已命中 6 包、7498 字节 |
| 防火墙失败仍报告成功 | 接口与规则成功才报告就绪，失败退出 | 正常启动通过，未逐项注入所有失败分支 |
| 整机重启丢失 TUN | DSM 开机钩子加载 tun.ko、创建设备并等待 Docker 启动隧道 | 再次整机重启后，无人工启动，服务自动恢复 |
| mini DNS 混淆查询类型 | 完整查询缓存键、问题区校验、TTL 递减与到期 | A、AAAA、TYPE65 混合查询通过 |
| 旧 DNS 切换任务仍引用废弃网段 | 备份停用旧任务，国内解析独立使用公共 DNS | NAS 离线窗口内国内网站及手机 App 可用 |
| 主备 DNS 的联网检测走不同路径 | 两端检测域名统一使用国内公共 DNS 解析 | 分别按两端解析结果访问，均为 200 / Success |
| 安装时容器未运行 | 配置先落盘，容器启动后加载；安装脚本补上先启动再检查 | 等待 dnsq 自动启动后，新规则生效 |

最终需要保留的运行文件如下，不能只修改当前容器：

```text
NAS /volume1/docker/homelab/network/wireguard/
  Dockerfile       安装 legacy 后端
  entry.sh         启动检查、每 60 秒补回规则
  firewall.sh      TCP、QUIC、NAT、转发规则统一入口
  quic-guard.sh    兼容入口，调用 firewall.sh
NAS /usr/local/etc/rc.d/wg-host-start.sh
                   加载 TUN，等待 Docker 并启动隧道
NAS /volume1/docker/homelab/network/dnsq/dnsq.py
                   联网检测域名走国内解析
mini /usr/local/etc/dnsq/dnsq.py
                   独立备用 DNS，修复缓存与检测域名解析
```

旧容器脚本、镜像标识和规则快照保留在 NAS 的 `wireguard/backup-*`；旧宿主机钩子也已备份停用。mini 的旧 dnsq 和旧 DNS 切换任务保留在它自己的 `backup-*` 目录。避免同时由宿主机和容器维护两套透明转发规则。

最后一次检查约在 07:38：NAS 已运行约五分钟，TUN、WireGuard、DNS、dnsq 和 tproxy 均恢复；测试 Mac `.108` 经默认网络访问百度约 0.13 秒、Google 约 0.26 秒、Apple 联网检测页约 0.13 秒，全部 HTTP 200。停机窗口中，京东、淘宝、哔哩哔哩、工行官网及手机国内 App 可用也分别得到验证。

另外澄清两个容易误判的现象：ChatGPT trace 为 JP，是原有 OpenAI 策略组选日本节点的结果，本次没有把默认香港策略改成日本，也没有测定所有网站的真实出口。macOS 的“Personal Hotspot Available”是热点邀请，仅凭通知不能认定 Wi-Fi 断网；它出现于重启窗口，但具体触发原因没有验证。后续以实际访问和联网检测结果判断，不通过关闭通知代替修复。

本轮没有重测完整 OAuth 登录、每一种 App、无限期 NAS 故障或所有 UDP/IPv6 路径。手机只确认了国内 App 可用，没有单独确认旧“无互联网连接”提示立即消失；不能把这些未完成项目写成已通过。

参考：[Alpine 3.22 的 iptables-legacy 包](https://pkgs.alpinelinux.org/package/v3.22/main/x86_64/iptables-legacy)。

## 六、小结

这套网络由 UBNT、NAS 和 Mac mini 分工完成：UBNT 做 IP 分流，NAS 上五个容器负责隧道、TCP 转发、DNS 与过滤列表，Surge 提供代理出口。日常客户端继续使用普通 DHCP 配置，网络服务集中在常开设备上管理。

后续调整也沿着这几层进行：修改大陆与境外的路径时看 UBNT，调整解析时看 AdGuard 和 dnsq，切换代理出口时看 Surge，新增 NAS 服务时单独配置该服务的代理环境。

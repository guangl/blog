---
title: 家庭网络改造实录：用 UBNT 策略路由 + WireGuard + Surge 做 IP 级分流
date: 2026-10-18 03:10:00
updated: 2026-10-19 15:29:41
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

这台群晖的 DSM 内核没有 WireGuard 模块，因此 `wg-home` 使用用户态的 `wireguard-go`。镜像基于 Alpine，安装 WireGuard 工具、`wg-quick`、`wireguard-go` 和 iptables。

服务端配置放在 `network/wireguard/wg0.conf`，容器内挂载到 `/config`。文件包含私钥和 peer 信息，不提交到仓库。UBNT 作为 WireGuard 客户端连接 NAS 的 UDP `51820`，隧道网段使用 `10.66.66.0/24`。

容器启动脚本依次完成：

1. 开启 `net.ipv4.ip_forward`，允许 NAS 转发 IPv4 流量。
2. 用 `wg-quick` 启动 `wg0`，通过 `wireguard-go` 提供用户态实现。
3. 加载公网 UDP 443 的限制规则，让隧道内浏览器连接回退到 TCP。
4. 按 NAS 默认出口网卡添加 MASQUERADE，并配置转发放行规则。
5. 每 60 秒检查一次接口，接口消失时尝试重建。

Compose 还配置了 `wg show wg0` 健康检查，用来判断接口是否存在；它本身不能证明代理上游可用。

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

这个转发程序只处理 TCP。WireGuard 启动时会调用 `quic-guard.sh`，丢弃从 `wg0` 进入、发往公网的 UDP 443，让浏览器回退到 TCP；`10.0.0.0/8`、`172.16.0.0/12` 和 `192.168.0.0/16` 私网目的地放行。它没有实现通用 UDP 代理，也不能保证识别使用 ECH 的真实域名。

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

UBNT 的 DHCP 配置需要启用自定义 DNS，并下发 NAS 地址。修改后在客户端确认实际收到的 DNS 地址。原部署记录中还在 Mac mini 上运行了一份备用分流解析器，由 DHCP 一并下发；它属于 Mac 侧服务，不在 NAS 的五个容器里。

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

当前配置下，WireGuard 断开后曾观察到境外流量回落直连，不能把 UBNT 的 kill switch 开关当作断线保护已经生效的证据。TCP 接管和公网 UDP 443 限制也不覆盖所有协议，其他 UDP 和 IPv6 仍需单独验证。启动脚本已做语法检查，但没有通过整台 NAS 重启验证持久化恢复。

### 2. 运行成本与已知限制

客户端操作减少了，服务端需要维护的东西却增加了。境外 TCP 访问依赖 UBNT、NAS 的 WireGuard 与转发程序、Mac mini 的 Surge，以及上游节点；DNS 还依赖 AdGuard Home 和 dnsq。NAS 和 Mac mini 都需要常开，五个容器、两个 Python 程序和路由规则也需要一起维护。

这套实现还有几个明确的边界：

- **境外链路更长。** 流量经过 WireGuard、NAS 用户态转发和 Surge，增加了处理环节；这台群晖还使用用户态 WireGuard，实际性能需要单独测量。
- **协议覆盖不完整。** Python 转发程序只接管 TCP；公网 UDP 443 通过丢弃促使浏览器回退，其他 UDP 没有因此自动获得代理能力。IPv6 尚未验证同样的分流策略。
- **断线保护尚不完整。** 当前配置下曾观察到 WireGuard 断开后境外流量回落直连，不能依赖 kill switch 开关保证阻断。
- **IP 地区与域名需求不总是一致。** UBNT 按 IP 地区决定是否进隧道，Surge 的域名规则只作用于交给它的连接；有特殊出口需求的服务，仍需检查实际路径和上游出口。
- **统一网段不提供额外隔离。** 日常设备放在同一个网段，便于使用；如果以后要隔离访客或 IoT 设备，仍需要另行规划网络和访问规则。

因此，这次改造更适合描述为把分流和代理服务集中管理。它改善了日常使用和职责划分，同时增加了服务之间的依赖。后续维护需要同时考虑这些依赖和边界。

## 五、小结

这套网络由 UBNT、NAS 和 Mac mini 分工完成：UBNT 做 IP 分流，NAS 上五个容器负责隧道、TCP 转发、DNS 与过滤列表，Surge 提供代理出口。日常客户端继续使用普通 DHCP 配置，网络服务集中在常开设备上管理。

后续调整也沿着这几层进行：修改大陆与境外的路径时看 UBNT，调整解析时看 AdGuard 和 dnsq，切换代理出口时看 Surge，新增 NAS 服务时单独配置该服务的代理环境。

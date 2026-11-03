---
title: 我的 Homelab：NAS、Mac mini 的配置、分工与取舍
date: 2026-11-03
updated: 2026-11-03
categories:
  - Homelab
tags:
  - Homelab
  - Synology
  - Mac mini
  - Docker
  - Immich
description: 从设备分工到影音、相册、DNS、反向代理和监控，记录我的 Homelab 如何配置、为什么这样配置，以及维护中需要承担的代价。
article:
  ai_label: generated
---

家里的 Homelab 主要围绕群晖 NAS、Mac mini 和 UniFi 网络搭建。NAS 保存数据并运行大部分应用，Mac mini 运行 Surge、反向代理和相册的机器学习服务，UniFi 负责家庭网络的网关与路由。

最初只是想把几个服务跑起来。服务逐渐增加以后，需要考虑的问题也变多了：照片交给谁保存，计算任务放在哪里，域名怎么指向应用，下载是否经过代理，以及一台设备重启时会影响什么。

这篇把这些配置和取舍一起记下来。部署清单依据配置仓库在 **2026 年 11 月 3 日对照 NAS、Mac mini 和反向代理更新的记录**。本文根据这次实机核验后导出的 `deploy/` 和 `templates/runtime/` 配置更新；这是配置快照及其取舍说明，不代表本文又执行了一次重启或故障验收。

<!-- more -->

## 一、整体分工：数据集中在 NAS，部分服务放在 Mac mini

### 设备和地址

家庭主网使用 `192.168.10.0/24`。主要地址及职责如下：

| 设备或服务 | 地址 | 职责 |
| --- | --- | --- |
| UniFi / UDM | `192.168.10.1` | 默认网关与家庭网络路由 |
| Mac mini | `192.168.10.4` | Surge、Nginx Proxy Manager、Immich 机器学习 |
| 群晖 NAS | `192.168.10.5` | 存储、主要应用、DNS、网关容器、监控与通知 |
| qBittorrent | `192.168.10.6:8080` | 使用独立局域网地址的下载服务 |

NAS 当前部署记录中有 17 个运行容器，Mac mini 有 2 个。数据库、缓存、通知等后台组件也计算在内，所以容器数量不等于应用入口数量。

按功能看，主要分成几组：

| 功能 | 组件 | 所在主机 |
| --- | --- | --- |
| 影音与下载 | Emby、Ani-RSS、qBittorrent、Sublarr | NAS |
| 相册 | Immich Server、数据库、Redis | NAS |
| 相册机器学习 | Immich Machine Learning | Mac mini |
| 网络 | AdGuard Home、SmartDNS、Sing-box 网关、AutoSSH 隧道 | NAS |
| 代理与反向代理 | Surge、Nginx Proxy Manager | Mac mini |
| 首页与监控 | Glance、Glances、Uptime Kuma | NAS |
| 更新与通知 | Watchtower、Apprise、手机通知路由 | NAS |

### 为什么分成两台

照片、媒体文件和应用数据集中在 NAS，文件路径和存储管理比较集中；Mac mini 则承担需要原生运行的 Surge，以及独立的机器学习服务。反向代理也放在 Mac mini，统一转发到 NAS 上的应用。

这样可以让两台常开设备分别承担工作，减少相册机器学习任务与 NAS 其他任务直接争用同一台主机资源的机会。不过这只是资源分配方式，本文没有两种部署方式的同条件性能对比，不据此声称识别速度或整机吞吐提升了多少。

代价是应用依赖跨了主机。NAS 和 Mac mini 任意一台离线，都可能影响某个完整功能；排查时还要检查两台主机之间的连接。两台设备也不等于高可用：目前没有把相册、反向代理或 DNS 做成可自动接管的双机集群。

## 二、应用入口：用域名统一访问，由 Mac mini 转发

### 怎么配置

Nginx Proxy Manager，简称 NPM，运行在 Mac mini。当前部署记录中的监听端口为：

| 端口 | 用途 |
| --- | --- |
| `80` / `443` | HTTP / HTTPS 反向代理入口 |
| `7001` | NPM 管理界面 |

每个应用建立自己的域名转发，后端使用固定的内网地址和端口。当前映射包括：

| 域名 | 后端 | 后端协议 |
| --- | --- | --- |
| `home.guangluo.top` | `192.168.10.5:6001` | HTTP |
| `movie.guangluo.top` | `192.168.10.5:6100` | HTTP |
| `anime.guangluo.top` | `192.168.10.5:6101` | HTTP |
| `download.guangluo.top` | `192.168.10.6:8080` | HTTP |
| `photo.guangluo.top` | `192.168.10.5:6104` | HTTP |
| `top.guangluo.top` | `192.168.10.5:6002` | HTTP |
| `monitor.guangluo.top` | `192.168.10.5:6003` | HTTP |
| `adguard.guangluo.top` | `192.168.10.5:6200` | HTTP |
| `nas.guangluo.top` | `192.168.10.5:5001` | HTTPS |
| `nginx.guangluo.top` | `192.168.10.4:7001` | HTTP |

例如，相册的代理条目可以理解为：

```text
访问域名：photo.guangluo.top
代理后端协议：http
代理后端地址：192.168.10.5
代理后端端口：6104

浏览器 → HTTPS 域名入口 → Mac mini NPM → NAS Immich
```

这说明 HTTPS 在入口与后端之间可能分段：浏览器到 NPM 使用 HTTPS，不代表 NPM 到 NAS 的连接也使用 HTTPS。DSM 的后端则明确使用 HTTPS，不能把所有代理条目一律配置为 HTTP。

域名解析和代理配套配置。当前 SmartDNS 把 `home`、`movie`、`anime`、`download`、`monitor`、`top`、`nginx`、`nas`、`adguard` 等域名解析到 Mac mini 的 `192.168.10.4`，并抑制这些域名的 AAAA 回答；`dsm.guangluo.top` 则直接解析到 NAS `.5`。因此 `nas` 是代理入口，`dsm` 是另一个直达 NAS 的名字，两者不能混为一谈。当前这份本地记录没有单独定义 `photo`，不能仅凭相册代理条目存在就认定本地解析也已覆盖。

NPM 的数据目录和证书目录分别持久化到 `/data` 和 `/etc/letsencrypt`。恢复时两份都要考虑：导出的转发表只能帮助重建规则，不能恢复账号、证书和私钥。

还有一个现有遗留项：NPM 容器 DNS 仍设置为 `192.168.5.1`。这是实际配置中保留的值，不是当前主网地址，也不应作为新部署推荐值；迁移时需要核对其可达性并选用正确 DNS。

### 为什么集中反代

这样做首先是为了访问方便。相册、下载和影音分别使用一个容易记的域名，后端端口变更时可以只调整代理条目。HTTPS 入口也能集中管理。

代价是 Mac mini 上的 NPM 成了共享依赖。即使 NAS 应用运行正常，NPM 停机也会让这些域名入口不可用。保留内网后端地址用于排查，可以区分应用故障和入口故障。

另一个取舍是信任范围：HTTP 后端依赖局域网环境，入口加密不能覆盖这一段。是否需要进一步加密，要结合内网隔离和应用支持决定。

最后，能建立域名入口不代表应该公开所有后台。当前清单只说明转发关系，不代表所有服务都经过了公网开放、登录保护和权限范围的逐项验收。

## 三、影音和下载：各做一件事，下载明确走直连

### 服务如何组合

Emby 提供媒体库与播放入口，Ani-RSS 负责订阅，qBittorrent 承担下载，Sublarr 承担字幕相关工作。这些职责分别由独立服务承担，维护时可以单独查看应用状态。

当前媒体服务是 `media-emby`。仓库历史 Compose 中的 Jellyfin 不是当前部署依据，也不能把其中的旧媒体挂载路径直接复制到现有服务。

### 媒体目录和读写权限

当前媒体根目录为 `/volume1/homes/guangluo/entertainments`，通过 `MEDIA_ROOT` 参数提供给公开编排；应用配置根目录则是 `/volume1/docker/homelab`，由 `HOMELAB_ROOT` 指定。

| 服务 | NAS 目录 | 容器内目录 | 权限 |
| --- | --- | --- | --- |
| Emby | `${MEDIA_ROOT}/Media` | `/media` | 只读 |
| Sublarr | `${MEDIA_ROOT}` | `/media` | 可写 |
| qBittorrent、Ani-RSS | `${MEDIA_ROOT}` | `/entertainments` | 可写 |
| qBittorrent、Ani-RSS | `${HOMELAB_ROOT}/application/family-media-system-runtime/DOWNLOADS` | `/fms-downloads` | 可写 |
| qBittorrent | `${HOMELAB_ROOT}/application/qbittorrent/downloads` | `/downloads` | 可写 |

Emby 只读媒体目录，能够读取和播放文件，但不能通过这份挂载修改媒体原文件；它自己的配置写入独立 `/config`。字幕服务需要写入媒体侧文件，所以保留可写权限。下载器与订阅器同时挂载相同的 `/entertainments` 和 `/fms-downloads`，减少彼此传递路径时的歧义。

代价是不同容器里的同名目录不一定代表同一范围：Emby 的 `/media` 只对应 `Media` 子目录，Sublarr 的 `/media` 对应整个媒体根目录。排查文件不可见时要看源目录，不能只比较容器内路径。本次配置也不能证明已经使用硬链接或完成了自动整理规则验收。

权限没有完全统一：Emby 使用 UID `1026`、GID `100`；qBittorrent 当前仍使用 `0:0`，Sublarr 明确以 root 进入容器。这样保留了当前兼容状态，但意味着下载与字幕服务权限较高，不能把设置了 PUID/PGID 就等同于所有进程均为普通用户，更不能对全部数据统一递归改所有者。

### 下载为什么单独处理路由

当前 qBittorrent 使用独立地址 `192.168.10.6`，另有内部地址 `172.30.61.2`。应用代理类型设为 `None`，peer、BT、RSS、miscellaneous 代理开关关闭；Ani-RSS 的应用代理也关闭。

只关闭应用代理还不够，因为下层网关仍可能把流量送进代理。为此，Sing-box 在通用分流规则前加入来源地址直连规则。仓库中的实际规则片段为：

```json
{
  "source_ip_cidr": [
    "192.168.10.6/32",
    "172.30.61.2/32"
  ],
  "action": "route",
  "outbound": "direct"
}
```

这是插入既有 `route.rules` 前部的一条规则，**不是完整 Sing-box 配置**。它还配合 Tracker 主机、种子源域名和关键词直连规则，并保留原有协议识别后的 BitTorrent 直连及 UDP 直连规则。Surge 侧也在通用规则前加入对应的来源地址、进程和域名规则。

这样分几层处理，是因为协议识别无法可靠判断所有加密连接的用途。固定下载客户端的来源地址更明确，域名和进程规则则补充其他入口。两边都设置，是为了让流量经过任一分流环节时仍遵守下载直连的约定。

### 好处和代价

下载直连可以避免 BT 流量占用代理出口，也让下载行为与日常网页代理的规则分开。固定来源地址还方便排查：来自这台下载器的流量应该有明确出口。

代价是这两个来源地址的流量会整体直连，并非只有可识别的 BT 数据。某个 Tracker 或订阅源在直连网络不可达时，也会受影响。目前约定是直连失败就保留失败，不自动回退代理。

独立地址通过 `qb_direct_lan` macvlan 网络提供：父接口是 NAS 的 `bond0`，网关为 `.1`，qBittorrent 固定为 `.6`，不再用宿主机端口映射发布 Web UI。另一个 `qb_control` 是 `172.30.61.0/24` 的内部 bridge 网络，下载器固定为 `.2`，Ani-RSS 和 Kuma 也接入它，用于控制与检查。下载器 DNS 指向该网络的 `172.30.61.1`，恢复时要确保 NAS 的 AdGuard 在这个接口上可访问。

这样把局域网下载身份与容器间控制连接分开，但网络依赖也更多。macvlan 存在宿主机默认不能直接访问自身容器的限制，Glance 当前因此通过 Mac mini 反代检查下载服务。换主机时还要替换 `bond0`、检查网段冲突，不能原样照搬。

新增下载器或改变地址后，也必须同步更新来源规则。现有规则无法自动识别所有设备上“下载种子”这个用途，不能只加几个关键词就认为覆盖完整。

## 四、Immich：主体放 NAS，机器学习独立部署

### 怎么拆分

NAS 运行 `immich-server`、`immich-database` 和 `immich-redis`，Mac mini 运行 `immich-machine-learning`，机器学习服务监听 `3003`。

```text
浏览器 / 手机
    ↓
NPM → NAS Immich Server → NAS 数据库、Redis、照片存储
                ↓
         Mac mini 机器学习服务 :3003
```

上图表达的是组件依赖，不表示每次打开相册都会同步经过机器学习服务。

服务端通过环境变量明确指定远端机器学习地址：

```yaml
IMMICH_MACHINE_LEARNING_URL: http://192.168.10.4:3003
DB_HOSTNAME: immich-database
DB_PORT: '5432'
REDIS_HOSTNAME: immich-redis
```

数据库和缓存通过 Docker 服务名连接，不需要把数据库端口暴露到局域网。虽然缓存容器沿用 `immich-redis` 名称，实际镜像已是 Valkey。

服务端数据目录为 `${HOMELAB_ROOT}/application/immich/data`，挂载到 `/data`；现有照片目录 `${MEDIA_ROOT}/Photos` 另以只读方式挂到 `/mnt/photos`。这样区分应用管理的数据与外部照片目录，也限制应用通过外部挂载改动原照片。但挂载存在本身不代表管理界面里的外部图库扫描已经配置或验收。

机器学习的可达性检查使用：

```text
http://192.168.10.4:3003/ping
```

NAS 服务端则检查：

```text
http://192.168.10.5:6104/api/server/ping
```

两个检查分开，便于发现“相册服务端可达，但机器学习服务不可达”的情况。HTTP 探测成功仍不能代替实际上传、检索或识别任务验收。

### 为什么这么拆

照片和数据库留在 NAS，可以集中管理持久数据；机器学习任务在另一台主机执行，便于单独分配资源和维护。

代价是多了一条跨主机依赖。Mac mini 重启或网络中断时，依赖机器学习的任务可能失败或等待，不能根据相册页面可打开就判断全部功能正常。两个服务的版本兼容性也需要一起关注，升级不能只看单个容器启动成功。

当前机器学习配置明确是 `DEVICE: cpu`，没有依据宣称使用 Apple GPU 或其他硬件加速。配置了 2 个 worker，单 worker 超时 600 秒，模型缓存持久化到 `/cache`，内存上限 6 GiB，健康检查预留 180 秒启动期。持久缓存减少重建容器后重复下载模型的需要；双 worker 提供并发，也会增加内存和 CPU 压力，不能简单理解为速度翻倍。

NAS 相册服务端内存上限为 10240 MiB，Node 堆设置为 4096 MiB；数据库上限 3072 MiB，共享内存 1 GiB，`shared_buffers` 为 1024 MB，`maintenance_work_mem` 为 256 MB。数据库的 `effective_cache_size=8GB` 是规划器估计值，不是额外分配的 8 GB 内存。上限也不代表常态实际占用，不能直接相加当作实测资源消耗。

### 数据该怎么理解

相册至少要区分照片原文件、数据库，以及可重新生成的缓存或派生文件。照片保存内容，数据库保存应用中的关系和状态；只备份 Compose 无法恢复这些数据。

因此完整恢复需要同时考虑文件和数据库，并核对备份时间的一致性。本文没有确认现有备份周期、保留策略和恢复演练结果，这部分仍是需要补齐的运行记录。

## 五、DNS 与网关：分开职责，也承担更多依赖

### DNS：AdGuard 接客户端，SmartDNS 负责上游与缓存

当前 NAS 三个网络容器均使用 host 网络。AdGuard 在 `0.0.0.0:53` 提供 DNS，管理界面为 `6200`；上游只有 `127.0.0.1:6053`，没有设置 fallback DNS。SmartDNS 仅监听回环的 UDP/TCP `6053`。

```text
客户端 DNS 请求 → NAS AdGuard :53（过滤、查询观察）
                   → SmartDNS 127.0.0.1:6053（缓存、域名分组）
                      ├─ 国内域名表 → 阿里 / 腾讯 DoH，直连
                      └─ 其他域名 → Surge SOCKS .4:6153 → Cloudflare / Google DoH
```

AdGuard 的缓存关闭，缓存集中在 SmartDNS，避免两层缓存各自影响排查。SmartDNS 缓存大小为 16384，写入持久文件并启用预取；过期缓存窗口配置为 300 秒，返回过期记录的 TTL 为 3 秒。缓存有助于减少重复查询，上游短暂异常时也可能继续提供答案；代价是结果可能暂时过时，不能以缓存命中代替上游健康检查。

境外 DoH 使用域名 URL 保留 TLS 的 SNI / HTTP Host，同时固定连接 IP，例如：

```text
proxy-server socks5://192.168.10.4:6153 -name surge
server-https https://cloudflare-dns.com/dns-query -host-ip 1.1.1.1 -proxy surge
server-https https://dns.google/dns-query -host-ip 8.8.8.8 -proxy surge
server-https https://dns.alidns.com/dns-query -host-ip 223.5.5.5 -group domestic -exclude-default-group
nameserver /domain-set:china/domestic
```

固定 IP 减少解析上游域名时的循环依赖，域名 URL 和挂载的 CA 证书用于校验身份；代价是固定 IP 失效时需要更新。国内组排除在默认组之外，只由国内域名表选中。默认不测速，国内域名另外配置 `tcp:443` 测速和 `first-ping` 响应策略。

当前 AdGuard 没有全局禁用 AAAA，SmartDNS 也没有沿用旧文件中全面抑制 AAAA 和 TYPE65 的设置；部分本地域名单独禁止 AAAA。不能继续把旧文件里的 IPv6 限制写成当前策略。

Compose 让 AdGuard 等待 SmartDNS 健康后启动，但健康检查查询的是本地 `home` 域名。这能检查本地解析接口，不足以证明境外 DoH、Surge 或所有上游正常。没有 fallback 有利于保持统一过滤与分流语义，代价是上游链路失败时不会自动改走另一套公共 DNS。

### 网关：WireGuard 仍在，由 Sing-box 内置端点接收

旧的 `wg-home`、dnsq、tproxy 独立容器已经停用，但 WireGuard 协议仍在使用。现在由 Sing-box 的内置 WireGuard endpoint 接收，`system: false`，监听 UDP `51820`，隧道地址 `10.66.66.1/24`，MTU 为 1420。对端允许地址包含 `10.66.66.2/32` 与家庭主网。

因此准确的变化是：从多个旧容器组合收敛到 Sing-box 内置隧道与路由，不是“已经不用 WireGuard”。UDM 对端及其完整策略仍属于外部配置，本文只说明 NAS 侧已导出的规则。

对于进入 Sing-box 的流量，处理顺序为：

1. 下载器来源地址、Tracker 与种子源规则优先直连。
2. 私网地址直连。
3. 尝试协议嗅探，识别为 BitTorrent 的连接直连。
4. 命中国内 IP 或域名规则集时直连。
5. 尚未匹配的 UDP 443 拒绝，其余 UDP 直连。
6. 剩余流量默认通过 SOCKS5 到 Mac mini Surge 的 `6153`。

顺序会影响结果：国内规则在 UDP 443 拒绝前，所以不能说所有 QUIC 都被阻断；下载器来源也在最前面，不受后面的通用代理选择影响。拒绝剩余 UDP 443 意在促使支持回退的客户端使用 TCP，但不保证每个应用都会回退。

其余 UDP 是直连，不是通用 UDP 代理。如果某个应用要求境外 UDP 也经过代理，当前规则不满足这个要求。域名嗅探也有识别边界，不能据此宣称所有加密流量都能按真实域名分流。

国内规则集每一天更新一次，更新请求经 Surge；同时保留本地规则文件与缓存，减少启动时完全依赖远端下载的需要。这也意味着首次恢复时要准备规则快照，后续更新仍依赖 Mac mini 的代理出口。

### 公网隧道是另一条链路

AutoSSH 从 NAS 主动连接云端，当前反向转发之一为云端 `127.0.0.1:16001` 到 NAS `6001`，对应 Glance。云端仅回环监听，外部入口还需要云端反代等配置，不能把它理解成直接向公网开放 16001。

SSH 设置了严格主机密钥校验、转发失败退出和保活检测，密钥及 `known_hosts` 以只读目录挂载。这样能降低连错服务器及连接失效后长期不重连的风险，代价是云端更换主机密钥时要人工核实更新。另一个 `16106 → NAS:6106` 转发仍指向停用后端，是已记录但尚未清理的遗留项。

### 集中网络服务的收益与成本

集中管理过滤、解析和分流，方便统一修改规则，也方便观察问题。但应用之间的依赖会更长：DNS 故障可能表现为网站打不开，网关故障可能表现为某一类目的地址超时，Surge 故障又可能只影响需要代理的部分请求。

NAS 同时承载 DNS 和多种应用，维护 NAS 时影响可能超出媒体和相册。备用 DNS 是否真正独立、客户端是否及时切换、NAS 离线时哪些连接仍可用，都需要对当前方案重新测试。旧网络方案曾做过故障测试，不能直接当作新方案已经通过的证据。

## 六、Glance：首页既要好用，也要说明检查范围

### 配置如何组织

Glance 的入口是 `maintenance/glance/config/glance.yml`，通过 include 分成首页、家庭服务、开发和摄影页面，具体组件放在 `widget/`。

现有编排中，Glance 的关键映射是：

```yaml
ports:
  - 6001:8080
volumes:
  - ./glance/config:/app/config
  - /var/run/docker.sock:/var/run/docker.sock
```

配置目录从宿主机挂入，便于修改 YAML 后热重载。Docker socket 用于读取 NAS 本机容器状态；它看不到 Mac mini 的 Docker 清单，因此 Mac mini 服务另用 HTTP 探测。

首页只显示失败提醒，家庭服务页展示完整检查，减少日常首页里重复的正常状态。服务链接使用 HTTPS 域名，检查优先使用内网后端。例如仓库中的 Immich 组件：

```yaml
- title: Immich 相册
  url: https://photo.guangluo.top
  check-url: http://192.168.10.5:6104/api/server/ping
  icon: si:immich
```

点击去域名入口，后台检查 NAS 应用，两者有不同用途。

### 为什么把入口和检查地址分开

内网探测减少了 DNS、证书和反向代理对应用状态判断的干扰。出现问题时，更容易区分 NAS 应用没有响应，还是域名入口出了故障。

代价是检查范围有限：Immich 卡片正常，不代表 `photo.guangluo.top` 的完整访问链路正常。要监测用户实际使用的入口，还需要另加域名层面的检查，不能用后端探测替代。

qBittorrent 是一个例外。由于 Glance 容器无法直连其独立网络地址，检查使用 `https://download.guangluo.top`。因此这张卡片失败可能来自下载器，也可能来自 NPM 或 DNS，需要继续拆解。

### 权限与统计

Docker socket 很方便，但它是高权限接口。Glance 能接触它，就需要把 Glance 当作有较高信任级别的服务维护；单纯把 socket 文件标成只读，也不能据此认定 Docker API 只能执行只读操作。

应用统计使用环境变量中的 API key，通过请求头传递，不写进 URL 或 Git。Emby 的变量名暂时保留 `JELLYFIN_API_KEY` 以兼容现有配置，值实际是 Emby key。这个兼容能减少变更，但也容易误导后续维护者，所以需要写清楚。

UniFi 组件使用本地 API key。因为控制器使用自签名证书，仅该组件放宽证书校验；这样能接入现有控制器，但会失去该请求原有的证书身份校验，范围不应随意扩大到所有请求。

## 七、监控、通知与更新：看到异常还不够

Glances 用来观察 NAS 的 CPU、内存和磁盘，Uptime Kuma 用于可用性监控，Apprise 与手机通知路由负责通知链路。Glance 是查看入口，不承担所有监控职责。

之所以保留 Glances，是为了读取主机资源，而不是把首页容器自己的 CPU 和内存占用误当成整台 NAS 的指标。可用性监控与资源观察分开后，也更容易区分“能访问但很慢”和“完全无法访问”。

代价是监控本身也要维护。如果监控和通知都依赖 NAS，NAS 整机掉线时，它们可能同时失效。需要发现整机故障时，应考虑独立观察点；当前记录不足以确认已有外部监控覆盖。

Watchtower 当前每天北京时间 04:00 扫描，开启清理、包含重启中容器，通过 Shoutrrr 发送扫描、更新及失败报告；生命周期钩子关闭。Emby 和 Sublarr 明确设置 `watchtower.enable=false`，不会按普通更新目标处理。

新整理的公开编排把镜像固定到核验时实际使用的 registry digest，便于恢复相同版本。它与“持续跟随可变标签自动升级”是不同的维护方式：固定 digest 后，升级需要选择新摘要并重新部署。此次只是导出配置，没有把运行中的所有项目切换到这些新入口，因此不能据此推断现网 Watchtower 的实际更新目标已全部变成固定摘要。

自动清理可以减少旧镜像占用，也会减少本地保留的回退材料。相册、数据库等有状态服务仍需在升级前准备数据备份，通知成功也不能替代升级后的应用验收。

通知同样如此。服务存在不等于异常一定能送达，至少要通过一次测试消息和一次真实故障触发来检查完整链路；本次文章整理没有执行这些测试。

## 八、配置仓库如何维护，为什么不能直接整组重建

`homelab-docker` 现在已经按实机核对结果整理当前部署：`deploy/nas/` 对应 NAS 的 17 个容器与 8 个部署单元，`deploy/macmini/` 对应 NPM 和机器学习；`deploy/inventory.json` 记录原 Compose 路径、端口与网络。旧的大编排已移出当前目录，需要时查 Git 历史。

公开模板使用 `HOMELAB_ROOT`、`MEDIA_ROOT`、`NPM_ROOT`、`ML_ROOT` 区分编排位置和数据位置。挂载配置普遍使用 `create_host_path: false`，路径不存在时停止，避免路径拼错后自动创建空目录，让应用看起来像第一次安装。

这提高了恢复的可检查性，代价是首次部署需要先准备真实目录、权限、配置和私有参数。模板中的密码、WireGuard 私钥、SSH 私钥和通知收件地址都是占位或外部文件，不能仅凭公开仓库恢复完整环境。

### 恢复顺序与边界

恢复时先准备文件与一致性的数据库备份、私有参数、外部 Docker 网络和 Surge / UDM / 云端依赖，再在对应主机运行：

```bash
# NAS
bash scripts/current.sh check nas
bash scripts/current.sh apply nas

# Mac mini
bash scripts/current.sh check macmini
bash scripts/current.sh apply macmini
```

脚本先检查配置与挂载，再拉取镜像、按顺序启动并等待健康状态。失败时保留数据并退出，不自动删除卷或回滚。没有健康检查的服务只能确认运行，之后仍需验收登录、DNS、媒体目录、通知和反代。

Immich、Ani-RSS 与 qBittorrent 的文件共享 `homelab_application` 项目名，不能随意对其中一个文件使用 `--remove-orphans`，否则可能移除同项目里的其他服务。两台主机上也有同名项目，它们属于不同 Docker 环境，不能把全部文件直接合并到一台主机执行。

公开仓库另有 Linux 核心安装脚本，但那是单机 12 容器的简化方案，不能用来完整恢复当前 19 容器与家庭网络拓扑。

### 配置备份仍不等于数据备份

需要另外保存照片与媒体、Immich 数据库和数据目录、Emby 与下载订阅配置、Kuma 监控数据库、NPM 数据和证书，以及各类密钥。NPM 转发表 JSON 不是可直接导入的数据库备份，只有它时需要重新建立条目和申请证书。

这次仓库整理没有替代备份，也没有执行完整恢复演练。现有运行环境并未因导出而重建；若要切换到新的公开编排入口，仍需核对原项目标记、挂载和私有参数。

Glance 配置更新则可以保持较小范围：备份后同步 YAML，在实际容器内执行校验，再检查页面和日志；仅改配置支持热重载，环境变量变化才重建容器。

```bash
docker exec glance /app/glance -config /app/config/glance.yml config:validate
```

## 九、这些选择带来的整体取舍

| 配置选择 | 得到的好处 | 需要承担的代价 |
| --- | --- | --- |
| 主要数据与应用集中 NAS | 存储和应用数据便于集中管理 | NAS 停机同时影响多类服务 |
| 机器学习放 Mac mini | 计算任务可单独分配和维护 | 跨主机连接与版本兼容需要一起管理 |
| Mac mini 集中反代 | 统一域名入口，隐藏后端端口变化 | 反代故障影响多个域名入口 |
| 下载器独立地址并强制直连 | 来源明确，避免占用代理出口 | 网络与路由配置更多，直连失败不回退代理 |
| 首页优先检查内网后端 | 更容易定位应用本身的问题 | 不能证明用户访问的完整域名链路正常 |
| 首页读取 Docker socket | 能直接展示 NAS 容器状态 | 增加首页服务的权限与信任范围 |
| 配置进入 Git，数据另行管理 | 配置变化可以追踪 | 完整恢复仍依赖文件、数据库和密钥备份 |

这套方案的特点是把日常服务集中起来，同时利用两台常开主机分担工作。它也把维护责任留给了自己：设备依赖、路由规则、应用版本和数据备份都要有人照看。

当前已经补齐实际 Compose、挂载和主要网络规则。接下来需要验证的是完整恢复过程与故障降级，并处理 NPM 的旧 DNS、停用后端转发和残留域名等遗留项。配置清单能说明系统如何组成，重启、故障与恢复演练才能说明它在异常时是否仍按预期工作。

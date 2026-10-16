# 大陆托管与备案

目标：把 `https://blog.guangluo.top/` 放到腾讯云 ECS（Debian 13 + Nginx）上，让大陆访问走境内网络，同时保留 Cloudflare Pages 作为海外入口和回滚通道。

## 为什么要多一台大陆机器

备案的硬门槛是「**接入商必须是中国大陆的持证厂商，且域名解析要指向它境内的 IP**」。Cloudflare Pages 是境外托管，没有大陆接入商，所以只靠它无法备案。

两条通道的定位：

| 通道 | 用途 | 工作流 |
| --- | --- | --- |
| Cloudflare Pages | 海外访问、备案期间的正式入口、回滚 | `.github/workflows/deploy-cloudflare.yml`（一直开启） |
| 腾讯云 ECS | 大陆主站 | `.github/workflows/deploy-server.yml`（用仓库变量 `SERVER_DEPLOY` 开关） |

证书是第三条独立的工作流：`.github/workflows/renew-server-cert.yml`（用仓库变量 `SERVER_CERT_RENEW` 开关），见下面的「[证书续期](#证书续期腾讯云免费-dv-证书)」。

⚠️ **备案通过前不要把域名解析到大陆机器**。腾讯云对大陆服务器会自动检测，未备案域名会被封禁；在那之前站点继续由 Cloudflare Pages 提供服务，访问不受影响。

## 前置条件

- 腾讯云 ECS，**中国大陆地域**，包年包月且购买时长 ≥ 3 个月（这是「备案云资源」的要求，另外必须勾选**免费分配独立公网 IP**、带宽不能为 0）。
- 安全组放行 **22 / 80 / 443**。
- 系统 Debian 13，默认以 `root` 登录（`SERVER_USER` 要与登录用户一致）。

## 步骤 1：初始化服务器

在本地执行，脚本经 stdin 送到服务器。**阶段一不需要邮箱**，证书那一步会跳过：

```bash
ssh root@<公网IP> 'bash -s' -- --skip-cert < deploy/server-setup.sh
```

脚本会装好 `nginx`、`certbot`、`rsync`，建出站点目录 `/var/www/blog.guangluo.top`（属主可用 `--owner` 指定），装上一份**只走 HTTP** 的 Nginx 配置，并摘掉 Debian 自带的默认站点。装完可以先用 `http://<公网IP>/` 确认 Nginx 在跑。

`--help` 可以看到全部参数；`--aliases ""` 表示只给主域名签证书、不处理 `www` 和裸域。

## 步骤 2：备案

在腾讯云 ICP 备案控制台做**首次备案**（备案跟域名和主体走，换厂商不需要「重新备案」，只有在别家已备案成功、现在要换接入商时才办接入备案）。要点：

| 环节 | 注意 |
| --- | --- |
| 网站名称 | 必须含中文、**≥3 个汉字**，不能用「博客、个人空间、网络、网站、工作室、平台、资讯」等词，也不能用地名和成语 |
| 网站内容 / 语言 | 内容选「其他」，语言选「中文简体」 |
| 域名 | 填主域名 `guangluo.top`，`www` 与 `blog` 二级域名自动覆盖 |
| 腾讯云初审 | 1～2 个工作日，**会打电话核实**：第一次未接 1 小时内再打一次，两次都不接直接驳回 |
| 工信部短信核验 | 提交管局后短信来自 **12381**，**24 小时内**必须完成（验证码 + 手机号 + 证件后六位），逾期退回重来 |
| 管局审核 | 1～20 个工作日，保持手机畅通 |
| 公安联网备案 | 管局通过后 30 日内，用腾讯云给的授权数据码去 <https://beian.mps.gov.cn> 办理 |

审核电话里网站名称要和备案系统里填的完全一致；用途就说「个人技术学习记录，非经营性，没有评论和注册功能」——本站确实没有接入评论系统。

## 步骤 3：切换解析

备案通过后，在 Cloudflare 把下面三个名字的 A 记录指向 ECS 公网 IP：

| 名称 | 类型 | 值 | 代理 |
| --- | --- | --- | --- |
| `blog` | A | ECS 公网 IP | **DNS only（灰云）** |
| `www` | A | ECS 公网 IP | **DNS only（灰云）** |
| `@` | A | ECS 公网 IP | **DNS only（灰云）** |

橙云代理必须关掉：开着的话备案核查看到的是 Cloudflare 的 IP，会被判定「接入信息与实际不符」，可能被取消接入。

## 步骤 4：签发证书（两条路，选一条）

用 `--cert-source` 选证书从哪来，默认 `letsencrypt`。两条路随时可以换：初始化脚本每次都按「哪些域名真的有证书」重写配置，换过去就是带着新的 `--cert-source` 重跑一次。

两条路的实际差别：

| | A. certbot + Let's Encrypt | B. 腾讯云免费 DV 证书 |
| --- | --- | --- |
| 证书 | 一张证书带 `blog` + `www` + 裸域三个 SAN | **一个域名一张**（免费证书是单域名） |
| 有效期 | 90 天，自动续 | 3 个月，自动续（见下一节） |
| 什么时候能签 | 必须先备案、解析切到本机 | 备案前就能签（走 DNS 验证） |
| 依赖 | ECS 能连上 Let's Encrypt | 腾讯云 CAM 密钥 + Cloudflare DNS Token |
| 额外配置 | 无 | 3 个 Secret、1 个 Variable、一条工作流 |

### A. certbot + Let's Encrypt（默认，零额外配置）

解析生效后（`dig +short blog.guangluo.top` 能看到 ECS 的 IP），重新跑一次同一个命令：

```bash
ssh root@<公网IP> 'bash -s' -- --email you@example.com < deploy/server-setup.sh
```

这次脚本会检测到域名已指向本机，用 certbot 的 webroot 方式签发证书（`blog` + `www` + 裸域一张证书），然后自动切到「HTTP 301 → HTTPS」的正式配置。证书续期由系统的 `certbot.timer` 负责，续期后会用 `--deploy-hook` 自动 reload nginx：

```bash
systemctl list-timers certbot.timer   # 确认续期任务存在
```

脚本每次装配置都会先跑 `nginx -t`，校验失败会**回滚到上一份配置**，不会把 nginx 弄挂。

### B. 腾讯云免费 DV 证书

先把服务器初始化好（这一步还不签证书），完整接线见下面的「[证书续期](#证书续期腾讯云免费-dv-证书)」：

```bash
ssh root@<公网IP> 'bash -s' -- --cert-source tencent --skip-cert < deploy/server-setup.sh
```

它的好处是**备案通过前就能把证书签好**（走 DNS 验证，不需要域名指向本机）。但证书签好不等于立刻上 HTTPS：域名还没指到这台机器时，脚本会继续用「只走 HTTP」的配置，好让你还能用 IP 直接访问。备案通过、解析切到本机之后，跑一次 `renew-server-cert` 工作流并勾上 `refresh`，配置就会切过去。

## 步骤 5：打开自动发布

仓库 **Settings → Secrets and variables → Actions**：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Variable | `SERVER_DEPLOY` | `true`（这是开关，不设就整条工作流跳过） |
| Variable | `SERVER_DEPLOY_PATH` | 可选，默认 `/var/www/blog.guangluo.top` |
| Secret | `SERVER_HOST` | ECS 公网 IP |
| Secret | `SERVER_USER` | 登录用户，要与站点目录属主一致 |
| Secret | `SERVER_SSH_KEY` | 登录用的**私钥**全文 |
| Secret | `SERVER_PORT` | 可选，默认 22 |

私钥在本地生成、公钥追加到服务器的 `~/.ssh/authorized_keys`：

```bash
ssh-keygen -t ed25519 -C 'github-actions-deploy' -f ~/.ssh/blog_deploy -N ''
ssh-copy-id -i ~/.ssh/blog_deploy.pub root@<公网IP>
```

配好后在 Actions 里手动跑一次 **Deploy to mainland server**（`workflow_dispatch`），确认 rsync 成功、`https://blog.guangluo.top/` 正常后再依赖 push 自动发布。

## 证书续期（腾讯云免费 DV 证书）

这一节只对「步骤 4 选 B」有意义。腾讯云免费证书是 **TrustAsia C1 DV Free：单域名、3 个月**，而且腾讯云的「自动部署」只覆盖它自家的云产品（CLB / CDN / DNSPod），**管不到 ECS 上自建的 Nginx**。所以这条路要么每 3 个月手动换一次，要么交给 `.github/workflows/renew-server-cert.yml`：

```
申请（腾讯云 SSL API）→ 写 DNS 验证记录（Cloudflare API）→ 等签发
  → 下载并解出 fullchain.pem + privkey.pem
  → rsync 到 ECS 暂存目录 → deploy/install-cert.sh 原子换证书（nginx -t 不过就回滚）
  → 重跑 deploy/server-setup.sh 重写配置 → 对一次线上证书指纹
```

分工：证书逻辑在 `tools/ssl-renew.mjs`，安装逻辑在 `deploy/install-cert.sh`，Nginx 配置仍然只由 `deploy/server-setup.sh` 写（它自带的 `nginx -t` 校验和回滚照旧生效）。

### 一次性接线

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Variable | `SERVER_CERT_RENEW` | `true`（这是开关，不设就整条工作流跳过） |
| Variable | `SERVER_CERT_THRESHOLD_DAYS` | 可选，默认 `21`：剩余天数低于它才续期 |
| Secret | `TENCENT_SECRET_ID` | 腾讯云 CAM 密钥 ID |
| Secret | `TENCENT_SECRET_KEY` | 腾讯云 CAM 密钥 Key |
| Secret | `CLOUDFLARE_DNS_TOKEN` | Cloudflare Token，权限 **Zone → DNS → Edit** |

`SERVER_HOST` / `SERVER_USER` / `SERVER_SSH_KEY` 与发布通道共用（`SERVER_PORT` 也是）。

- **腾讯云密钥**：访问管理 → 访问密钥 → API 密钥管理。权限最小化可以用子账号 + 自定义策略（只要能调 `ssl:ApplyCertificate`、`ssl:DescribeCertificates`、`ssl:DescribeCertificateDetail`、`ssl:DownloadCertificate`、`ssl:CheckCertificateDomainVerification`），图省事也可以用 `QcloudSSLFullAccess`。
- **Cloudflare Token**：My Profile → API Tokens → Create Token → Custom token，权限 `Zone → DNS → Edit`，Zone Resources 选 `guangluo.top`。发布通道用的那个 `CLOUDFLARE_API_TOKEN` **没有 DNS 权限**，别拿它顶替（那是故意的：发布不该能改 DNS）。
- **为什么用 DNS 验证**：域名 NS 在 Cloudflare，DNSPod 的「自动添加记录」用不了；文件验证要求域名已经解析到 ECS（也就是备案之后），而且验证文件还得躲开 `rsync --delete`。DNS 验证两条都不占，**备案通过前就能先把证书拿到手**——这也是选 B 最实际的好处。

配好后在 Actions 里手动跑一次 **Renew mainland server certificate**（勾上 `force`）。它会申请三张证书（`blog` / `www` / 裸域各一张）、装进服务器，最后打印每张证书的指纹。

**备案通过前，站点仍然是 HTTP**，这是设计如此：证书可以先签好放着（DNS 验证不需要域名指向大陆机器），但 Nginx 配置只有在域名**真的指到这台 ECS** 之后才会切到 HTTPS——否则用 IP 直接访问会被 301 到一个还不通的域名，等于把备案前的入口弄没了。判断逻辑是 `deploy/server-setup.sh` 第 4 节的 `resolves_here`，它复用初始化时就有的解析探测。等备案通过、Cloudflare 改灰云之后，跑一次工作流并勾上 `refresh`，配置就会自动切到 HTTPS。

### 日常是怎么跑的

- 定时：每周一 10:00（北京时间）跑一次。每次都先问腾讯云「还剩几天」，**只有剩余天数低于阈值（默认 21 天）才真的申请**——免费证书有配额，不能天天申请新的。所以工作流可以放心让它定时跑。
- `workflow_dispatch` 的三个选项：`force` 不管剩几天都重新申请（首次接线、或者想提前换就勾它）；`refresh` 只重写 Nginx 配置、不申请证书（备案切解析之后切 HTTPS 用它）；`check` 只报告剩余天数，不申请、不碰服务器。
- 服务器上的证书布局：一个域名一个目录，`/etc/nginx/ssl/<域名>/fullchain.pem` + `privkey.pem`（私钥 600）。Nginx 配置里每个 `server` 块引用自己那份，而且**只在这个块引用的证书真的覆盖该域名时**才生成（看 SAN；letsencrypt 那张证书带三个 SAN，所以备用域名会共用它）——某个备用域名还没证书时，它只在 80 端口做 301，不会让 `nginx -t` 失败，也不会拿一张不对的证书去握手。
- 换证书是**原子**的：先备份旧目录，写入新文件，跑 `nginx -t`；不通过就把备份拷回来再 `nginx -t`，然后退出非零。备份留在 `/etc/nginx/ssl/.backup/` 里，回滚命令脚本会打印出来。
- 工作流最后会比对一次线上 443 端口实际发出的证书指纹，**对不上只告警不报红**——备案前域名还指向 Cloudflare Pages，443 上当然是别人的证书。真正的保证在服务器那一侧：`install-cert.sh` 校验域名与私钥、跑过 `nginx -t`，失败会回滚并让 job 变红。等备案切了解析，那一行就会变成「线上证书就是刚装的那一份」；如果那时还告警，说明 Cloudflare 的橙云代理忘了关。

### 几个要知道的坑

- **备案通过后别忘了一次 `refresh`**：定时任务只在证书快到期时才换证书，也就不会顺带重写配置。所以备案完成、Cloudflare 改成灰云之后，要手动跑一次工作流并勾上 `refresh`（或者直接 `ssh root@<公网IP> 'bash -s' -- --cert-source tencent < deploy/server-setup.sh`）。忘了的话，站点会在 HTTP 上一直待到下一次续期——最长约 70 天。
- **配额和旧证书**：免费证书按账号限额发放，每次续期都会**新增**一张（不会覆盖旧的），控制台里会慢慢堆起来。旧证书过期后可以手动删掉，留着不影响使用。
- **这个工作流需要 root**：`install-cert.sh` 和 `server-setup.sh` 都要写 `/etc/nginx` 和 `/etc/letsencrypt`。现在部署就是用 root，所以没问题；以后按「安全加固」换成 `deploy` 用户时，得给它 sudo，或者把这两个脚本拆成带 sudo 的调用。
- **一个域名失败不影响其他域名**：某个域名验证卡住时，其他域名照样装完；失败的域名会在工作流最后统一报红并写进 job summary。下次定时任务会再试一次。
- **想换回 Let's Encrypt**：带着 `--cert-source letsencrypt --email <邮箱>` 重跑一次 `server-setup.sh` 就行。两种来源的证书目录路径不同（`/etc/nginx/ssl` 与 `/etc/letsencrypt/live`），互不覆盖，随时能换回来。
- **不想给 Cloudflare Token**：那就走文件验证——去腾讯云控制台申请证书、选「文件验证」，把验证文件放到服务器的 `/var/www/pki-validation/.well-known/pki-validation/`（Nginx 已经配好这个路径，`rsync --delete` 也删不到），签发后下载 Nginx 格式的包，解压后本地执行：

  ```bash
  ssh root@<公网IP> "mkdir -p /var/www/cert-staging/blog.guangluo.top"
  rsync -a Nginx/ root@<公网IP>:/var/www/cert-staging/blog.guangluo.top/
  ssh root@<公网IP> 'bash -s' -- --domain blog.guangluo.top --src /var/www/cert-staging/blog.guangluo.top < deploy/install-cert.sh
  ssh root@<公网IP> 'bash -s' -- --cert-source tencent --owner root < deploy/server-setup.sh
  ```

  这条路没有自动化，每 3 个月要手动走一遍。

## 日常发布与回滚

- 合并到 `main`：Cloudflare Pages 与腾讯云 ECS **两条通道都会更新**。
- 只想发布其中一条：在 Actions 里手动触发对应工作流。
- 回滚：`git revert` 后推送，或临时把 `SERVER_DEPLOY` 置为 `false` 停掉大陆通道。

## 备案号与百度收录

1. **页脚备案号（已接线）**：号码填进 `_config.yml` 的 `beian` 段就行——

   | 键 | 内容 |
   | --- | --- |
   | `beian.icp` | ICP 备案号，例如 `鄂ICP备2026000000号-1`，页脚会链接到 <https://beian.miit.gov.cn> |
   | `beian.police` | 公安联网备案号，例如 `鄂公网安备42010000000000号` |
   | `beian.police_url` | 可选，留空时用 <https://beian.mps.gov.cn> |

   留空时页脚一行都不输出，所以本地开发、海外构建和 Cloudflare Pages 都不受影响；填了之后 `bun run verify` 会校验「必须出现在页脚、且 ICP 号必须链到工信部备案系统」。注入实现在 `scripts/beian.js`，走 `after_render:html`——主题的 `footer.content` 在初始化时就被 `Object.freeze` 冻结了，构建期追加不进去。

2. **百度搜索资源平台（还没做）**：等拿到 token 后要补三处——`_config.yml` 的 `seo.verification.baidu`、`tools/check-site.mjs` 的 meta 映射、`tools/ping-search.mjs` 的「普通收录」推送。

3. `docs/domain-deployment.md` 里的收录状态更新。

## 安全加固（可选，后续再做）

当前部署用 `root` 登录，对个人博客可以接受。要收紧的话：

- `--owner deploy` 建一个专用用户，并把 `SERVER_USER` 改成它（注意：证书续期那条工作流也要跟着改，`deploy/install-cert.sh` 需要写 `/etc/nginx/ssl`，得给它 sudo 或单独的开机任务）；
- 服务器上限制该用户的命令（例如只允许 rsync）、改用非 22 端口；
- 服务器装 `ufw` 只放行 22 / 80 / 443，与腾讯云安全组双重限制；
- 定期轮换上面那几个密钥：腾讯云 CAM 密钥、Cloudflare DNS Token、部署私钥。

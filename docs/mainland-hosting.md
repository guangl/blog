# 大陆托管与备案

目标：把 `https://blog.guangluo.top/` 放到腾讯云 ECS（Debian 13 + Nginx）上，让大陆访问走境内网络，同时保留 Cloudflare Pages 作为海外入口和回滚通道。

## 为什么要多一台大陆机器

备案的硬门槛是「**接入商必须是中国大陆的持证厂商，且域名解析要指向它境内的 IP**」。Cloudflare Pages 是境外托管，没有大陆接入商，所以只靠它无法备案。

两条通道的定位：

| 通道 | 用途 | 工作流 |
| --- | --- | --- |
| Cloudflare Pages | 海外访问、备案期间的正式入口、回滚 | `.github/workflows/deploy-cloudflare.yml`（一直开启） |
| 腾讯云 ECS | 大陆主站 | `.github/workflows/deploy-server.yml`（用仓库变量 `SERVER_DEPLOY` 开关） |

⚠️ **备案通过前不要把域名解析到大陆机器**。腾讯云对大陆服务器会自动检测，未备案域名会被封禁；在那之前站点继续由 Cloudflare Pages 提供服务，访问不受影响。

## 前置条件

- 腾讯云 ECS，**中国大陆地域**，包年包月且购买时长 ≥ 3 个月（这是「备案云资源」的要求，另外必须勾选**免费分配独立公网 IP**、带宽不能为 0）。
- 安全组放行 **22 / 80 / 443**。
- 系统 Debian 13，默认以 `root` 登录（`SERVER_USER` 要与登录用户一致）。

## 步骤 1：初始化服务器

在本地执行，脚本经 stdin 送到服务器：

```bash
ssh root@<公网IP> 'bash -s' -- --email you@example.com < deploy/server-setup.sh
```

脚本会装好 `nginx`、`certbot`、`rsync`，建出站点目录 `/var/www/blog.guangluo.top`（属主可用 `--owner` 指定），装上一份**只走 HTTP** 的 Nginx 配置，并摘掉 Debian 自带的默认站点。此时因为域名还没解析过来，它会跳过证书签发并提示下一步。

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

## 步骤 4：签发证书

解析生效后（`dig +short blog.guangluo.top` 能看到 ECS 的 IP），重新跑一次同一个命令：

```bash
ssh root@<公网IP> 'bash -s' -- --email you@example.com < deploy/server-setup.sh
```

这次脚本会检测到域名已指向本机，用 certbot 的 webroot 方式签发证书（`blog` + `www` + 裸域一张证书），然后自动切到「HTTP 301 → HTTPS」的正式配置。证书续期由系统的 `certbot.timer` 负责，续期后会用 `--deploy-hook` 自动 reload nginx：

```bash
systemctl list-timers certbot.timer   # 确认续期任务存在
```

脚本每次装配置都会先跑 `nginx -t`，校验失败会**回滚到上一份配置**，不会把 nginx 弄挂。

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

## 日常发布与回滚

- 合并到 `main`：Cloudflare Pages 与腾讯云 ECS **两条通道都会更新**。
- 只想发布其中一条：在 Actions 里手动触发对应工作流。
- 回滚：`git revert` 后推送，或临时把 `SERVER_DEPLOY` 置为 `false` 停掉大陆通道。

## 待办：备案号与百度收录

备案通过后还需要补三处，目前都还没做：

1. **页脚备案号**：展示 ICP 备案号并链接 <https://beian.miit.gov.cn>（硬性要求），公安联网备案号也一并展示；
2. **百度搜索资源平台**：`_config.yml` 的 `seo.verification.baidu`、`tools/check-site.mjs` 的 meta 映射、`tools/ping-search.mjs` 的「普通收录」推送；
3. `docs/domain-deployment.md` 里的收录状态更新。

## 安全加固（可选，后续再做）

当前部署用 `root` 登录，对个人博客可以接受。要收紧的话：

- `--owner deploy` 建一个专用用户，并把 `SERVER_USER` 改成它；
- 服务器上限制该用户的命令（例如只允许 rsync）、改用非 22 端口；
- 服务器装 `ufw` 只放行 22 / 80 / 443，与腾讯云安全组双重限制。

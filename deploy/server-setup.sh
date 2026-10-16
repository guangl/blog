#!/usr/bin/env bash
#
# 腾讯云 ECS（Debian 13）初始化：Nginx + certbot + 站点目录
#
# 用法（在本地执行，把脚本经 stdin 送到服务器）：
#   ssh root@<公网IP> 'bash -s' -- --email you@example.com < deploy/server-setup.sh
#
# 脚本可以重复执行，分两个阶段：
#
#   阶段一（现在就能跑）：装 Nginx、建站点目录，装上一份「只走 HTTP」的配置。
#   阶段二（备案通过、把域名解析切到本机之后再跑一次）：检测到域名已指向本机，
#          自动用 certbot 签发证书，并切换到「HTTP 301 + HTTPS」的正式配置。
#
# 为什么不能第一次就签证书：Let's Encrypt 的 HTTP-01 验证要求域名解析指向本机，
# 而大陆机器在备案通过前不能拿未备案域名对外服务，所以顺序只能是
# 先备案 → 再切解析 → 再签证书。
#
# 参数：
#   --email <地址>    必填，Let's Encrypt 到期通知邮箱
#   --domain <域名>   主域名，默认 blog.guangluo.top
#   --aliases "<域名…>"  一起签发证书并 301 到主站的备用域名，
#                     默认 "www.guangluo.top guangluo.top"；传空字符串表示只要主域名
#   --owner <用户>    站点目录属主（也就是 GitHub Actions 里的 SERVER_USER），默认 root
#   --staging         用 Let's Encrypt 测试环境签发（调试用，浏览器不信任）
#   --skip-cert       只初始化，不尝试签发证书
#   -h | --help       显示帮助
#
set -euo pipefail

DOMAIN='blog.guangluo.top'
ALIASES='www.guangluo.top guangluo.top'
SITE_ROOT='/var/www/blog.guangluo.top'
ACME_ROOT='/var/www/acme'
OWNER='root'
EMAIL=''
STAGING=0
SKIP_CERT=0

AVAILABLE='/etc/nginx/sites-available/blog.guangluo.top'
ENABLED='/etc/nginx/sites-enabled/blog.guangluo.top'
CERT_DIR=''

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  # 通过 stdin 运行时（ssh root@… 'bash -s' < deploy/server-setup.sh）$0 是 bash，
  # 不能拿它去读脚本自身的注释，所以这里固定输出用法。
  if [ -r "$0" ] && head -1 "$0" 2>/dev/null | grep -q '^#!'; then
    sed -n '3,28p' "$0" | sed 's/^#\s\?//'
  else
    cat <<'USAGE'
用法（在本地执行，脚本经 stdin 送到服务器）：
  ssh root@<公网IP> 'bash -s' -- --email you@example.com < deploy/server-setup.sh

参数：
  --email <地址>        必填，Let's Encrypt 到期通知邮箱（用 --skip-cert 时可不填）
  --domain <域名>       主域名，默认 blog.guangluo.top
  --aliases "<域名…>"   一起签发证书并 301 到主站的备用域名，
                        默认 "www.guangluo.top guangluo.top"；传空字符串表示只要主域名
  --owner <用户>        站点目录属主（GitHub Actions 里的 SERVER_USER），默认 root
  --staging             用 Let's Encrypt 测试环境签发（调试用，浏览器不信任）
  --skip-cert           只初始化，不尝试签发证书
  -h | --help           显示帮助
USAGE
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --email) EMAIL="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --aliases) ALIASES="${2:-}"; shift 2 ;;
    --owner) OWNER="${2:-}"; shift 2 ;;
    --staging) STAGING=1; shift ;;
    --skip-cert) SKIP_CERT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（--help 查看用法）" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die '需要 root 权限：ssh root@<公网IP> 或用 sudo 运行'
if [ "$SKIP_CERT" -eq 0 ] && [ -z "$EMAIL" ]; then
  die '缺少 --email（Let'"'"'s Encrypt 的到期通知邮箱）'
fi

CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
SERVER_NAMES="$DOMAIN${ALIASES:+ $ALIASES}"

# ---------------------------------------------------------------------------
# 1. 依赖
# ---------------------------------------------------------------------------
log '安装 nginx / certbot / rsync'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx rsync curl >/dev/null

mkdir -p "$SITE_ROOT" "$ACME_ROOT/.well-known/acme-challenge"
# 站点目录要先有一个可访问的页面，Nginx 才不至于因为空目录报错
if [ ! -e "$SITE_ROOT/index.html" ]; then
  printf '<!doctype html><meta charset="utf-8"><title>%s</title><p>站点已就绪，等待首次发布。\n' "$DOMAIN" \
    > "$SITE_ROOT/index.html"
fi
chown -R "$OWNER":"$OWNER" "$SITE_ROOT"
# Debian 自带的默认站点会占用 80 端口的 default_server，先摘掉
rm -f /etc/nginx/sites-enabled/default

# ---------------------------------------------------------------------------
# 2. 配置模板（__XXX__ 占位符用 sed 替换，避免在 heredoc 里转义 nginx 的 $ 变量）
# ---------------------------------------------------------------------------
write_bootstrap_config() {
  cat <<'NGINX'
# 证书签发前使用的配置：只监听 80，直接提供站点内容。
# 由 deploy/server-setup.sh 安装；签发证书成功后会被正式配置替换。
server {
    listen 80;
    listen [::]:80;
    server_name __SERVER_NAMES__;

    root __SITE_ROOT__;
    index index.html;

    # certbot 的 webroot 验证目录。它独立于站点根目录，
    # 所以 GitHub Actions 的 rsync --delete 不会影响证书续期。
    location ^~ /.well-known/acme-challenge/ {
        root __ACME_ROOT__;
        default_type "text/plain";
    }

    location / {
        try_files $uri $uri/index.html $uri/ =404;
    }

    error_page 404 /404.html;
}
NGINX
}

write_https_config() {
  cat <<'NGINX'
# HTTP：只做两件事——转发 certbot 的验证请求，其余全部 301 到 HTTPS。
server {
    listen 80;
    listen [::]:80;
    server_name __SERVER_NAMES__;

    location ^~ /.well-known/acme-challenge/ {
        root __ACME_ROOT__;
        default_type "text/plain";
    }

    location / {
        return 301 https://__DOMAIN__$request_uri;
    }
}

# HTTPS：主站
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;                       # 需要 nginx >= 1.25.1，Debian 13 自带 1.26
    server_name __DOMAIN__;

    ssl_certificate         __CERT_DIR__/fullchain.pem;
    ssl_certificate_key     __CERT_DIR__/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    # 不开 OCSP stapling：Let's Encrypt 已停用 OCSP，开了只会在日志里刷失败；
    # 也不开 HSTS，等 HTTPS 稳定跑一段时间后再考虑加。

    root __SITE_ROOT__;
    index index.html;
    charset utf-8;
    server_tokens off;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    gzip on;
    gzip_vary on;
    gzip_comp_level 5;
    gzip_min_length 256;
    gzip_types text/plain text/css text/xml application/xml application/javascript application/json image/svg+xml;

    # Hexo 的目录式链接（/posts/、/2026/09/13/xxx/）落在各自的 index.html 上
    location / {
        try_files $uri $uri/index.html $uri/ =404;
        expires -1;                 # HTML 每次回源校验，避免读者拿到缓存的旧版本
    }

    # 静态资源带内容指纹，可以长缓存
    location ~* \.(?:css|js|mjs|woff2?|ttf|eot|svg|png|jpe?g|webp|avif|gif|ico)$ {
        expires 30d;
        access_log off;
    }

    # 站点地图、订阅源、robots 始终回源，方便搜索引擎和阅读器取到最新版本
    location ~ ^/(?:sitemap\.xml|atom\.xml|robots\.txt|search\.json)$ {
        expires -1;
    }

    error_page 404 /404.html;
}
NGINX
}

write_https_alias_block() {
  cat <<'NGINX'

# HTTPS：备用域名统一 301 到主站，避免搜索引擎把同一个站点分别收录
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name __ALIASES__;

    ssl_certificate     __CERT_DIR__/fullchain.pem;
    ssl_certificate_key __CERT_DIR__/privkey.pem;

    return 301 https://__DOMAIN__$request_uri;
}
NGINX
}

fill_placeholders() {
  sed -e "s|__SERVER_NAMES__|$SERVER_NAMES|g" \
      -e "s|__SITE_ROOT__|$SITE_ROOT|g" \
      -e "s|__ACME_ROOT__|$ACME_ROOT|g" \
      -e "s|__DOMAIN__|$DOMAIN|g" \
      -e "s|__CERT_DIR__|$CERT_DIR|g" \
      -e "s|__ALIASES__|$ALIASES|g"
}

# 装上配置并用 nginx -t 校验；校验失败就回滚到上一份，绝不让 nginx 起不来
install_config() {
  local builder="$1"
  local backup=''
  local target
  target=$(mktemp)

  # 这里必须用 if，不能写 `[ … ] && [ … ] && func`：后者在条件不成立时返回 1，
  # 作为管道的最后一条命令会被 set -e 判成失败，脚本会静默退出。
  {
    "$builder"
    if [ -n "$ALIASES" ] && [ "$builder" = write_https_config ]; then
      write_https_alias_block
    fi
  } | fill_placeholders > "$target"

  if [ -f "$AVAILABLE" ]; then
    backup=$(mktemp)
    cp -a "$AVAILABLE" "$backup"
  fi
  install -m 644 "$target" "$AVAILABLE"
  ln -sfn "$AVAILABLE" "$ENABLED"
  rm -f "$target"

  if ! nginx -t; then
    if [ -n "$backup" ]; then
      cp -a "$backup" "$AVAILABLE"
      warn '配置校验失败，已回滚到上一份配置'
    else
      rm -f "$ENABLED" "$AVAILABLE"
      warn '配置校验失败，已移除该站点配置'
    fi
    rm -f "$backup"
    die '请检查上面的 nginx -t 报错，修好后重新运行本脚本'
  fi
  [ -n "$backup" ] && rm -f "$backup"

  systemctl enable nginx >/dev/null 2>&1 || true
  systemctl is-active --quiet nginx || systemctl start nginx
  systemctl reload nginx
  log "配置已生效：$AVAILABLE"
}

# ---------------------------------------------------------------------------
# 3. 域名是否已经指向本机
# ---------------------------------------------------------------------------
public_ip() {
  # 腾讯云 CVM 的公网 IP 走 NAT，机器上只能看到内网地址（10.x），
  # 所以优先问云厂商的元数据服务，再用外部回显兜底（必须强制 IPv4，
  # 否则在有 IPv6 的机器上会拿到 IPv6 地址）。
  local ip=''
  ip=$(curl -fsS --max-time 3 http://metadata.tencentyun.com/latest/meta-data/public-ipv4 2>/dev/null || true)
  [ -n "$ip" ] || ip=$(curl -fsS -4 --max-time 8 https://api.ipify.org 2>/dev/null || true)
  [ -n "$ip" ] || ip=$(curl -fsS -4 --max-time 8 https://ifconfig.me/ip 2>/dev/null || true)
  [ -n "$ip" ] || ip=$(curl -fsS -4 --max-time 8 https://ipinfo.io/ip 2>/dev/null || true)
  printf '%s' "$ip" | tr -d '[:space:]'
}

SERVER_IP=$(public_ip)
case "$SERVER_IP" in
  10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*)
    warn "只探测到内网地址（$SERVER_IP），不能拿它判断解析是否生效"
    SERVER_IP=''
    ;;
esac
resolves_here() {
  local host="$1"
  [ -n "$SERVER_IP" ] || return 1
  getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u | grep -qx "$SERVER_IP"
}

# 这一节只是预检提示，用来告诉你「解析大概走到哪一步了」；
# 真正决定要不要签证书的是下面 4.5 的 ACME 探测。
for host in $SERVER_NAMES; do
  if resolves_here "$host"; then
    log "$host 已解析到本机（$SERVER_IP）"
  elif [ -n "$SERVER_IP" ]; then
    warn "$host 还没有解析到本机（本机公网 IP：$SERVER_IP）"
  fi
done

# ---------------------------------------------------------------------------
# 4. 装配置
# ---------------------------------------------------------------------------
if [ -f "$CERT_DIR/fullchain.pem" ]; then
  install_config write_https_config
else
  install_config write_bootstrap_config
fi

# ---------------------------------------------------------------------------
# 4.5 域名是否真的指向本机：直接探一次 ACME 路径
#
# 比「解析出来的 IP 等于本机公网 IP」可靠得多：把探测文件写进 ACME 目录，
# 再从公网按域名取回来，内容一致就说明解析、80 端口和 nginx 的 ACME 路径全都通了。
# 云厂商的 NAT 公网 IP、IPv6、CDN 代理这些情况也一并覆盖。
# ---------------------------------------------------------------------------
ACME_READY=1
if [ "$SKIP_CERT" -eq 0 ] && [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  for host in $SERVER_NAMES; do
    token="probe-$$-$RANDOM"
    printf '%s' "$token" > "$ACME_ROOT/.well-known/acme-challenge/$token"
    got=$(curl -fsS --max-time 10 "http://$host/.well-known/acme-challenge/$token" 2>/dev/null || true)
    rm -f "$ACME_ROOT/.well-known/acme-challenge/$token"
    if [ "$got" = "$token" ]; then
      log "$host 的 ACME 探测通过（解析、80 端口、nginx 都就绪）"
    else
      ACME_READY=0
      warn "$host 的 ACME 探测没通过"
    fi
  done
fi

# ---------------------------------------------------------------------------
# 5. 签发证书
# ---------------------------------------------------------------------------
if [ "$SKIP_CERT" -eq 1 ]; then
  warn '按 --skip-cert 跳过证书签发'
elif [ -f "$CERT_DIR/fullchain.pem" ]; then
  log "已存在证书（$CERT_DIR），跳过签发；续期由 certbot.timer 负责"
elif [ "$ACME_READY" -ne 1 ]; then
  warn '域名还没指向本机，先不签发证书（也可能是 80 端口没放行，或还挂着 CDN 代理）。'
  warn "备案通过后把 $SERVER_NAMES 的 A 记录指向本机公网 IP${SERVER_IP:+（$SERVER_IP）}，Cloudflare 关掉橙云代理，再跑一次本脚本即可。"
else
  log '开始签发证书（Let'"'"'s Encrypt）'
  certbot_args=(certonly --webroot -w "$ACME_ROOT" -n --agree-tos --no-eff-email
                --expand --keep-until-expiring --deploy-hook 'systemctl reload nginx'
                --email "$EMAIL")
  [ "$STAGING" -eq 1 ] && certbot_args+=(--staging)
  for host in $SERVER_NAMES; do certbot_args+=(-d "$host"); done

  if certbot "${certbot_args[@]}"; then
    log '证书签发成功，切换到 HTTPS 配置'
    install_config write_https_config
  else
    warn '证书签发失败（通常是解析还没生效或 80 端口被安全组挡住）。'
    warn '站点暂以 HTTP 提供，排查后重新运行本脚本即可，其他步骤都已就绪。'
  fi
fi

systemctl enable --now certbot.timer >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 6. 收尾提示
# ---------------------------------------------------------------------------
cat <<EOF

——————————————————————————————————————————————
初始化完成

  站点根目录   $SITE_ROOT
  站点属主     $OWNER（GitHub Actions 里的 SERVER_USER 要与它一致）
  Nginx 配置   $AVAILABLE
  证书目录     $CERT_DIR
  本机公网 IP  ${SERVER_IP:-未能自动识别，以腾讯云控制台显示的为准}

接下来：
  1. 腾讯云控制台 → 安全组 → 放行 22 / 80 / 443
  2. 备案通过后，把 $SERVER_NAMES 的 A 记录指向本机公网 IP，
     Cloudflare 上必须改成 DNS only（灰云），代理开着会让备案核查看到 Cloudflare 的 IP
  3. 再跑一次本脚本签发证书：
     ssh root@<公网IP> 'bash -s' -- --email ${EMAIL:-<你的邮箱>} < deploy/server-setup.sh
  4. 在 GitHub 仓库打开自动发布：
     Variables: SERVER_DEPLOY=true（可选 SERVER_DEPLOY_PATH）
     Secrets:   SERVER_HOST=<公网IP>、SERVER_USER=$OWNER、SERVER_SSH_KEY=<私钥>

证书续期由 systemctl 的 certbot.timer 负责，可用下面这条确认：
  systemctl list-timers certbot.timer
——————————————————————————————————————————————
EOF

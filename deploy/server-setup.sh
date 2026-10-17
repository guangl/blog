#!/usr/bin/env bash
#
# 腾讯云 ECS（Debian 13）初始化：Nginx + 站点目录 + 证书
#
# 用法（在本地执行，把脚本经 stdin 送到服务器）：
#   ssh root@<公网IP> 'bash -s' -- --email you@example.com < deploy/server-setup.sh
#
# 脚本可以重复执行，分两个阶段：
#
#   阶段一（现在就能跑）：装 Nginx、建站点目录，装上一份「只走 HTTP」的配置。
#   阶段二（证书就位之后再跑一次）：切换到「HTTP 301 + HTTPS」的正式配置。
#
# 证书有两种来源，用 --cert-source 选（默认 letsencrypt）：
#
#   letsencrypt  脚本自己用 certbot 走 HTTP-01 签发，证书落在
#                /etc/letsencrypt/live/<主域名>/，续期交给 certbot.timer。
#                代价是必须等备案通过、域名解析切到本机之后才能签。
#   tencent      用腾讯云免费 DV 证书（TrustAsia C1，单域名、3 个月）。
#                证书由 tools/ssl-renew.mjs + .github/workflows/renew-server-cert.yml
#                申请和续期，脚本只负责把它们装进
#                /etc/nginx/ssl/<域名>/，本脚本不再碰 certbot。
#                好处是域名没备案也能先签（走 DNS 验证），续期全自动。
#
# 为什么 letsencrypt 不能第一次就签：HTTP-01 验证要求域名解析指向本机，
# 而大陆机器在备案通过前不能拿未备案域名对外服务，所以顺序只能是
# 先备案 → 再切解析 → 再签证书。
#
# 参数：
#   --email <地址>    Let's Encrypt 到期通知邮箱；--cert-source letsencrypt 时必填
#   --domain <域名>   主域名，默认 blog.guangluo.top
#   --aliases "<域名…>"  一起签发证书并 301 到主站的备用域名，
#                     默认 "www.guangluo.top guangluo.top"；传空字符串表示只要主域名
#   --cert-source <letsencrypt|tencent>  证书来源，默认 letsencrypt
#   --owner <用户>    站点目录属主（也就是 GitHub Actions 里的 SERVER_USER），默认 root
#   --staging         用 Let's Encrypt 测试环境签发（调试用，浏览器不信任）
#   --skip-cert       只初始化，不尝试签发证书（只对 letsencrypt 有意义）
#   -h | --help       显示帮助
#
set -euo pipefail

DOMAIN='blog.guangluo.top'
ALIASES='www.guangluo.top guangluo.top'
SITE_ROOT='/var/www/blog.guangluo.top'
ACME_ROOT='/var/www/acme'
# 腾讯云免费证书走文件验证时，验证文件挂在这个目录（独立于站点根目录，
# 所以 GitHub Actions 的 rsync --delete 不会把它删掉）。
PKI_ROOT='/var/www/pki-validation'
OWNER='root'
EMAIL=''
CERT_SOURCE='letsencrypt'
STAGING=0
SKIP_CERT=0

AVAILABLE='/etc/nginx/sites-available/blog.guangluo.top'
ENABLED='/etc/nginx/sites-enabled/blog.guangluo.top'
# 压缩配置放在 conf.d（http 级），三个入口共用，详见 install_compression_conf
COMPRESSION_CONF='/etc/nginx/conf.d/blog-compression.conf'
# 证书根目录：下面每个域名一个子目录，各放 fullchain.pem + privkey.pem。
# letsencrypt 时 certbot 只给「主域名」建目录，备用域名共用它那份（一张证书带 SAN）；
# tencent 时每个域名各有各的目录（免费证书是单域名，只能一张一个）。
CERT_BASE=''

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  # 通过 stdin 运行时（ssh root@… 'bash -s' < deploy/server-setup.sh）$0 是 bash，
  # 不能拿它去读脚本自身的注释，所以下面准备了固定输出的兜底分支。
  #
  # 用法文本从头部注释里现取：从第 3 行起逐行打印注释，遇到「-h | --help」那一行
  # 或第一行非注释就停（后面 Nginx 模板的 heredoc 里也有顶格的 # 行，不能一路打印过去），
  # 所以以后在头部加几行说明，--help 不会错位。
  if [ -r "$0" ] && head -1 "$0" 2>/dev/null | grep -q '^#!'; then
    awk 'NR > 2 { if (/^#/) { print; if ($0 ~ /^#   -h \| --help/) exit } else exit }' "$0" \
      | sed 's/^#[[:space:]]\{0,1\}//'
  else
    cat <<'USAGE'
用法（在本地执行，脚本经 stdin 送到服务器）：
  ssh root@<公网IP> 'bash -s' -- --email you@example.com < deploy/server-setup.sh

参数：
  --email <地址>        Let's Encrypt 到期通知邮箱（--cert-source letsencrypt 时必填）
  --domain <域名>       主域名，默认 blog.guangluo.top
  --aliases "<域名…>"   一起签发证书并 301 到主站的备用域名，
                        默认 "www.guangluo.top guangluo.top"；传空字符串表示只要主域名
  --cert-source <letsencrypt|tencent>  证书来源，默认 letsencrypt（见脚本头部注释）
  --owner <用户>        站点目录属主（GitHub Actions 里的 SERVER_USER），默认 root
  --staging             用 Let's Encrypt 测试环境签发（调试用，浏览器不信任）
  --skip-cert           只初始化，不尝试签发证书（只对 letsencrypt 有意义）
  -h | --help           显示帮助
USAGE
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --email) EMAIL="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --aliases) ALIASES="${2:-}"; shift 2 ;;
    --cert-source) CERT_SOURCE="${2:-}"; shift 2 ;;
    --owner) OWNER="${2:-}"; shift 2 ;;
    --staging) STAGING=1; shift ;;
    --skip-cert) SKIP_CERT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（--help 查看用法）" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die '需要 root 权限：ssh root@<公网IP> 或用 sudo 运行'
case "$CERT_SOURCE" in
  letsencrypt) CERT_BASE='/etc/letsencrypt/live' ;;
  tencent)     CERT_BASE='/etc/nginx/ssl' ;;
  *) die "未知的 --cert-source：$CERT_SOURCE（可选 letsencrypt / tencent）" ;;
esac
# 只有「真的要用 certbot 签」才强求邮箱；tencent 来源由 workflow 申请证书，脚本不需要邮箱
if [ "$SKIP_CERT" -eq 0 ] && [ "$CERT_SOURCE" = letsencrypt ] && [ -z "$EMAIL" ]; then
  die '缺少 --email（Let'"'"'s Encrypt 的到期通知邮箱）'
fi

SERVER_NAMES="$DOMAIN${ALIASES:+ $ALIASES}"

# 某个域名该用哪份证书：
#   1. 自己的目录有证书就用自己那份（tencent：每个域名一张）；
#   2. 否则退回主域名那份（letsencrypt：certbot 的一张证书带全部 SAN）；
#   3. 两份都没有就返回非零，调用方据此决定「这个域名暂时不上 443」。
cert_dir_for() {
  local host="$1"
  if [ -f "$CERT_BASE/$host/fullchain.pem" ]; then
    printf '%s' "$CERT_BASE/$host"
    return 0
  fi
  if [ "$host" != "$DOMAIN" ] && [ -f "$CERT_BASE/$DOMAIN/fullchain.pem" ]; then
    printf '%s' "$CERT_BASE/$DOMAIN"
    return 0
  fi
  return 1
}

# 这份证书真的覆盖这个域名吗？看 SAN 列表。
# letsencrypt 那张证书三个域名都在 SAN 里，所以备用域名会共用它上 443；
# 腾讯云免费证书是单域名，某个备用域名自己的证书还没到位时，宁可不上 443，
# 也不要拿一张不覆盖它的证书去握手（那样浏览器只会报域名不匹配，更难查）。
# openssl 不可用或读不出 SAN 时按「覆盖」处理，也就是退回旧行为，不因为读不到就少配一块。
cert_covers() {
  local dir="$1" host="$2" sans
  command -v openssl >/dev/null 2>&1 || return 0
  sans=$(openssl x509 -in "$dir/fullchain.pem" -noout -text 2>/dev/null \
    | grep -o 'DNS:[^,]*' | sed 's/^DNS://' | tr -d ' ')
  [ -n "$sans" ] || return 0
  printf '%s\n' "$sans" | grep -qx "$host" && return 0
  # 通配符：*.guangluo.top 覆盖 www.guangluo.top，但不覆盖裸域 guangluo.top
  printf '%s\n' "$sans" | grep -qx "*.${host#*.}" && return 0
  return 1
}

# ---------------------------------------------------------------------------
# 1. 依赖
# ---------------------------------------------------------------------------
log '安装 nginx / rsync / curl / openssl'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx rsync curl openssl >/dev/null
if [ "$CERT_SOURCE" = letsencrypt ]; then
  log '安装 certbot（--cert-source letsencrypt）'
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
fi

mkdir -p "$SITE_ROOT" "$ACME_ROOT/.well-known/acme-challenge"
# 腾讯云免费证书的文件验证目录：与站点根目录分开，rsync --delete 删不掉它
mkdir -p "$PKI_ROOT/.well-known/pki-validation"
if [ "$CERT_SOURCE" = tencent ]; then
  mkdir -p "$CERT_BASE"
fi
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
#
# 只生成**一份**配置，它同时照顾两种访问方式：
#   · 按域名访问（备案通过、解析切到本机之后）：80 上 301 到 HTTPS，443 上提供服务；
#   · 用 IP 直连（备案前的主要入口）：80 的默认站点直接给内容，443 也能连
#     （证书是签给域名的，浏览器用 IP 访问会提示名字不匹配，这是预期内的；
#      想干净地验证书链就用 curl --resolve blog.guangluo.top:443:<IP>）。
# 这样就不存在「先装 HTTP 配置、备案后再换成 HTTPS 配置」的两套状态，
# 也就没有「备案后忘了切」这个坑。
# ---------------------------------------------------------------------------

# 80 的默认站点：凡是不匹配下面那些域名 server_name 的请求（也就是用 IP 直连）
# 都落在这里，直接把站点内容给出去。
write_http_default_block() {
  cat <<'NGINX'
# HTTP 默认站点：用 IP 直连时走这里，直接提供站点内容
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root __SITE_ROOT__;
    index index.html;

    # certbot 的 webroot 验证目录。它独立于站点根目录，
    # 所以 GitHub Actions 的 rsync --delete 不会影响证书续期。
    location ^~ /.well-known/acme-challenge/ {
        root __ACME_ROOT__;
        default_type "text/plain";
    }

    # 腾讯云免费证书的文件验证路径（trustasia 会来取这个文件）
    location ^~ /.well-known/pki-validation/ {
        root __PKI_ROOT__;
        default_type "text/plain";
    }

    location / {
        try_files $uri $uri/index.html $uri/ =404;
    }

    error_page 404 /404.html;
}
NGINX
}

# 按域名访问时走的那个 80 站点，两种形态：
#   redirect —— 主域名证书已就位：除两家证书验证路径外全部 301 到 HTTPS
#   serve    —— 还没有证书：直接提供内容，免得把人跳到一个还不存在的 HTTPS 上
# 两家的验证路径必须留在 301 之前（location / 里的 return 才管得到其余请求），
# 否则 certbot 的 HTTP-01 和腾讯云的文件验证都会被自己 301 掉。
write_http_domain_block() {
  local mode="$1"
  cat <<'NGINX'

# HTTP：按域名访问
server {
    listen 80;
    listen [::]:80;
    server_name __SERVER_NAMES__;

    location ^~ /.well-known/acme-challenge/ {
        root __ACME_ROOT__;
        default_type "text/plain";
    }

    location ^~ /.well-known/pki-validation/ {
        root __PKI_ROOT__;
        default_type "text/plain";
    }
NGINX
  if [ "$mode" = redirect ]; then
    printf '\n    location / {\n        return 301 https://%s$request_uri;\n    }\n}\n' "$DOMAIN"
  else
    cat <<'NGINX'

    root __SITE_ROOT__;
    index index.html;

    location / {
        try_files $uri $uri/index.html $uri/ =404;
    }

    error_page 404 /404.html;
}
NGINX
  fi
}

# HTTPS 主站。同时是 443 的默认站点，所以用 IP 或未知 SNI 访问会落到这里
# （浏览器会提示证书名字不匹配，但连接是通的，`curl -k https://<IP>/` 能拿到页面）。
write_https_main_block() {
  cat <<'NGINX'

# HTTPS：主站
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    http2 on;                       # 需要 nginx >= 1.25.1，Debian 13 自带 1.26
    server_name __DOMAIN__;

    ssl_certificate         __CERT_BASE__/__DOMAIN__/fullchain.pem;
    ssl_certificate_key     __CERT_BASE__/__DOMAIN__/privkey.pem;
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
    # 下面这几条要和 Cloudflare Pages 那条通道保持一致：Nginx 不认 _headers 文件，
    # 值由 scripts/cloudflare-headers.js 生成，这里的字符串必须逐字符相同
    # （tools/check-site.mjs 会比对两处，改一处忘了另一处就构建失败）。
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://gcore.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://gcore.jsdelivr.net; img-src 'self' data:; font-src 'self' data: https://cdnjs.cloudflare.com; media-src 'self'; frame-src 'self'; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests" always;
    add_header X-Frame-Options "DENY" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" always;
    add_header Cross-Origin-Resource-Policy "same-origin" always;

    # 压缩不在这里配：gzip 提到了 http 级（/etc/nginx/conf.d/blog-compression.conf，
    # 由 install_compression_conf 写入）。写在这个 443 块里只覆盖这一台站点，
    # 而 IP 直连走的是 80 的默认站点，那样它会原样发 388KB 的 main.css。

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

# 备用域名统一 301 到主站，避免搜索引擎把同一个站点分别收录。
# 一个域名一个 server 块（腾讯云免费证书是单域名，每家一份证书目录），
# 所以这里按域名逐个生成；证书还没到位、或者手上这份证书不覆盖这个域名的，先不上 443，
# 只在 80 端口按域名 301（那台站点的 80 块会把它转到主站）。
# 注意 __ALIAS__ 和 __CERT_DIR__ 是在循环里就地替换的（每个块的值都不一样），
# 其余占位符仍然由下面的 fill_placeholders 统一处理。
write_https_alias_blocks() {
  local alias cert_dir
  for alias in $ALIASES; do
    if ! cert_dir=$(cert_dir_for "$alias"); then
      warn "$alias 还没有证书，暂时只在 80 端口 301（拿到证书后重跑本脚本即可上 443）"
      continue
    fi
    if ! cert_covers "$cert_dir" "$alias"; then
      warn "$alias 只能拿到 $cert_dir 那份证书，它不覆盖这个域名，先不上 443（等它自己的证书到位）"
      continue
    fi
    cat <<'NGINX' | sed -e "s|__ALIAS__|$alias|g" -e "s|__CERT_DIR__|$cert_dir|g"

# HTTPS：备用域名 301 到主站
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name __ALIAS__;

    ssl_certificate     __CERT_DIR__/fullchain.pem;
    ssl_certificate_key __CERT_DIR__/privkey.pem;

    return 301 https://__DOMAIN__$request_uri;
}
NGINX
  done
}

fill_placeholders() {
  sed -e "s|__SERVER_NAMES__|$SERVER_NAMES|g" \
      -e "s|__SITE_ROOT__|$SITE_ROOT|g" \
      -e "s|__ACME_ROOT__|$ACME_ROOT|g" \
      -e "s|__PKI_ROOT__|$PKI_ROOT|g" \
      -e "s|__CERT_BASE__|$CERT_BASE|g" \
      -e "s|__DOMAIN__|$DOMAIN|g"
}

# ---------------------------------------------------------------------------
# 2.5 压缩（http 级）
#
# 为什么放 conf.d 而不是某个 server 块里：nginx 的 gzip 只作用于「所在的块及其子块」。
# 写在 443 主站块里，就只覆盖那一台站点；而本站有三个入口——
#   · 80 的默认站点（IP 直连，备案前唯一能用的入口）
#   · 80 的域名站点（还没有证书时直接给内容）
#   · 443 的主站点
# 只配在 443 上，前两个入口就会把 388KB 的 main.css 原样发出去。而 ECS 单流带宽
# 实测约 220KB/s，这一项就差 1.5 秒。放到 http 级后三个入口都吃到同一份配置，
# 也不存在「以后再开一个入口忘了配压缩」这个问题。
#
# 只写压缩，不碰缓存头 / sendfile / open_file_cache，那些要单独评估。
# ---------------------------------------------------------------------------
# nginx.conf（http 级）里是否已经有生效的 `gzip on;`？
# Debian 自带的 /etc/nginx/nginx.conf 默认就有一行，但它下面的 gzip_types
# 全是注释——默认只压 text/html，所以 CSS / JS 其实是原样发出去的。
# 我们要补的正是那些参数；可 `gzip on` 在同一个 http 块里再写一遍会报
# `duplicate directive "gzip"`，nginx -t 直接失败，所以先看一眼主配置。
main_conf_enables_gzip() {
  grep -qE '^[[:space:]]*gzip[[:space:]]+on[[:space:]]*;' /etc/nginx/nginx.conf 2>/dev/null
}

write_compression_conf() {
  cat <<'NGINX'
# 由 deploy/server-setup.sh 生成，重跑脚本会覆盖，别在这里手改。
#
# 这份文件由 /etc/nginx/nginx.conf 里的 `include /etc/nginx/conf.d/*.conf;`
# 带进 http 块，所以三个入口（80 默认站点 / 80 域名站点 / 443 主站点）都继承它。
# 实测 main.css 388 KB → gzip 后约 50 KB；首页资源合计约 532 KB → 约 90 KB。
NGINX
  if main_conf_enables_gzip; then
    printf '%s\n' '# gzip on 由 nginx.conf 提供，这里只补它没写的那些参数。'
  else
    printf '%s\n' '# nginx.conf 里没有 http 级的 gzip on，这里自己打开。' 'gzip on;'
  fi
  cat <<'NGINX'
gzip_vary on;
gzip_comp_level 5;
gzip_min_length 256;
# 以后接腾讯云 CDN / EdgeOne 时，回源请求带 Via / X-Forwarded-For，
# 不设 any 的话这类请求会绕过压缩，CDN 回源拿到的就是原始大小。
gzip_proxied any;
gzip_types
    text/plain
    text/css
    text/xml
    text/javascript
    application/javascript
    application/json
    application/xml
    application/rss+xml
    application/atom+xml
    application/ld+json
    application/manifest+json
    image/svg+xml;
NGINX
}

install_compression_conf() {
  local target="$COMPRESSION_CONF" tmp
  mkdir -p "$(dirname "$target")"
  tmp=$(mktemp)
  write_compression_conf > "$tmp"

  # 内容没变就不动文件、不 reload，重跑脚本时不会白白抖一下 nginx
  if [ -f "$target" ] && cmp -s "$tmp" "$target"; then
    rm -f "$tmp"
    log "压缩配置已是最新：$target"
    return 0
  fi

  install -m 644 "$tmp" "$target"
  rm -f "$tmp"

  if ! nginx -t; then
    rm -f "$target"
    die "压缩配置没通过 nginx -t，已移除 $target（站点配置未受影响）。若报 duplicate directive，说明 nginx.conf 里已有同名指令，删掉本文件里对应的一行即可"
  fi
  log "已写入压缩配置：$target"
}

# 装上配置并用 nginx -t 校验；校验失败就回滚到上一份，绝不让 nginx 起不来
install_config() {
  local backup=''
  local target
  target=$(mktemp)

  # 这里必须用 if，不能写 `[ … ] && [ … ] && func`：后者在条件不成立时返回 1，
  # 作为管道的最后一条命令会被 set -e 判成失败，脚本会静默退出。
  {
    write_http_default_block
    if [ -n "$MAIN_CERT_DIR" ]; then
      write_http_domain_block redirect
      write_https_main_block
    else
      write_http_domain_block serve
    fi
    if [ -n "$ALIASES" ]; then
      write_https_alias_blocks
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
#
# 只装一份自适应配置（见第 2 节）：主域名证书在不在，决定的是「按域名访问时
# 80 端口是 301 还是直接提供内容」，以及 443 上有没有站点；
# 用 IP 直连的请求永远落在 80 的默认站点上，直接把内容给出去——
# 所以备案前不需要为了保住 IP 入口而放弃 HTTPS，也不需要备案后再换一套配置。
# 两种证书来源的「有证书」都落在 $CERT_BASE/$DOMAIN/fullchain.pem 上，这里不用分来源。
# ---------------------------------------------------------------------------
MAIN_CERT_DIR=''
MAIN_CERT_DIR=$(cert_dir_for "$DOMAIN" || true)
# 压缩先装：它只改 conf.d，和站点配置无关，失败时不会连累下面的站点配置
install_compression_conf
install_config

# ---------------------------------------------------------------------------
# 4.5 域名是否真的指向本机：直接探一次 ACME 路径
#
# 比「解析出来的 IP 等于本机公网 IP」可靠得多：把探测文件写进 ACME 目录，
# 再从公网按域名取回来，内容一致就说明解析、80 端口和 nginx 的 ACME 路径全都通了。
# 云厂商的 NAT 公网 IP、IPv6、CDN 代理这些情况也一并覆盖。
#
# 只有 letsencrypt 需要这一步：tencent 来源的证书由 workflow 走 DNS 验证申请，
# 跟本机解析、80 端口都没关系。
# ---------------------------------------------------------------------------
ACME_READY=1
if [ "$CERT_SOURCE" = letsencrypt ] && [ "$SKIP_CERT" -eq 0 ] && [ -z "$MAIN_CERT_DIR" ]; then
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
# 5. 证书
# ---------------------------------------------------------------------------
if [ "$CERT_SOURCE" = tencent ]; then
  # 证书不在这里签发：tools/ssl-renew.mjs 负责申请（DNS 验证）和续期，
  # 本脚本只负责把 /etc/nginx/ssl/<域名>/ 里的证书接进 Nginx 配置。
  if [ -n "$MAIN_CERT_DIR" ]; then
    log "已装好证书：$MAIN_CERT_DIR（续期由 GitHub Actions 的 renew-server-cert 负责）"
    if ! resolves_here "$DOMAIN"; then
      warn "$DOMAIN 还没指向本机${SERVER_IP:+（本机公网 IP：$SERVER_IP）}，所以现在别指望 https://$DOMAIN 能用。"
      warn "备案前用 IP 直连就行：http://${SERVER_IP:-<公网IP>}/ 直接给页面，https://${SERVER_IP:-<公网IP>}/ 也能连（浏览器会提示证书是发给 $DOMAIN 的）。"
      warn "想干净地验证书链：curl --resolve $DOMAIN:443:${SERVER_IP:-<公网IP>} https://$DOMAIN/"
    fi
  else
    warn "还没有 $DOMAIN 的证书，443 先不开，站点只走 HTTP（用 IP 直连访问正常）。"
    warn '先跑一次 renew-server-cert 工作流（或本地 node tools/ssl-renew.mjs），把证书装进 /etc/nginx/ssl/，再重跑本脚本。'
  fi
elif [ "$SKIP_CERT" -eq 1 ]; then
  warn '按 --skip-cert 跳过证书签发'
elif [ -n "$MAIN_CERT_DIR" ]; then
  log "已存在证书（$MAIN_CERT_DIR），跳过签发；续期由 certbot.timer 负责"
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
    log '证书签发成功，重新生成配置（80 端口切到 301、443 上开始服务）'
    install_config
  else
    warn '证书签发失败（通常是解析还没生效或 80 端口被安全组挡住）。'
    warn '站点暂以 HTTP 提供，排查后重新运行本脚本即可，其他步骤都已就绪。'
  fi
fi

if [ "$CERT_SOURCE" = letsencrypt ]; then
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------------------
# 6. 收尾提示
# ---------------------------------------------------------------------------
cat <<EOF

——————————————————————————————————————————————
初始化完成

  站点根目录   $SITE_ROOT
  站点属主     $OWNER（GitHub Actions 里的 SERVER_USER 要与它一致）
  Nginx 配置   $AVAILABLE
  证书来源     $CERT_SOURCE
  证书根目录   $CERT_BASE${MAIN_CERT_DIR:+（$DOMAIN 用 $MAIN_CERT_DIR）}
  本机公网 IP  ${SERVER_IP:-未能自动识别，以腾讯云控制台显示的为准}
  当前入口     http://${SERVER_IP:-<公网IP>}/（IP 直连，任何时候都通）
               ${MAIN_CERT_DIR:+https://${SERVER_IP:-<公网IP>}/（能连，浏览器会提示证书名字不匹配）}

接下来：
  1. 腾讯云控制台 → 安全组 → 放行 22 / 80 / 443
  2. 备案通过后，把 $SERVER_NAMES 的 A 记录指向本机公网 IP，
     Cloudflare 上必须改成 DNS only（灰云），代理开着会让备案核查看到 Cloudflare 的 IP
EOF

if [ "$CERT_SOURCE" = letsencrypt ]; then
  cat <<EOF
  3. 再跑一次本脚本签发证书：
     ssh root@<公网IP> 'bash -s' -- --email ${EMAIL:-<你的邮箱>} < deploy/server-setup.sh
  4. 在 GitHub 仓库打开自动发布：
     Variables: SERVER_DEPLOY=true（可选 SERVER_DEPLOY_PATH）
     Secrets:   SERVER_HOST=<公网IP>、SERVER_USER=$OWNER、SERVER_SSH_KEY=<私钥>

证书续期由 systemctl 的 certbot.timer 负责，可用下面这条确认：
  systemctl list-timers certbot.timer
EOF
else
  cat <<EOF
  3. 在 GitHub 仓库打开证书自动续期：
     Variables: SERVER_CERT_RENEW=true
     Secrets:   TENCENT_SECRET_ID / TENCENT_SECRET_KEY（腾讯云 CAM 密钥，证书相关权限）
                CLOUDFLARE_DNS_TOKEN（Cloudflare Token，Zone → DNS → Edit）
                以及 SERVER_HOST / SERVER_USER / SERVER_SSH_KEY（与发布通道共用）
  4. 手动跑一次 renew-server-cert 工作流，它会申请证书、装进 $CERT_BASE，
     然后调用本脚本重写 Nginx 配置，站点才会上 HTTPS
  5. 在 GitHub 仓库打开自动发布：
     Variables: SERVER_DEPLOY=true（可选 SERVER_DEPLOY_PATH）

证书每 3 个月到期一次，renew-server-cert 每月检查一次、剩余不足 21 天就换新。
EOF
fi

cat <<'EOF'
——————————————————————————————————————————————
EOF

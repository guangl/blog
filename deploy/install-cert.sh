#!/usr/bin/env bash
#
# 把一份证书装进 Nginx 的证书目录（在服务器上执行，脚本经 stdin 送到服务器）。
#
#   ssh root@<公网IP> 'bash -s' -- --domain blog.guangluo.top --src /var/www/cert-staging/blog.guangluo.top \
#     < deploy/install-cert.sh
#
# 典型调用者是 .github/workflows/renew-server-cert.yml：它先用 tools/ssl-renew.mjs
# 从腾讯云申请并下载证书，scp 到 --src 指向的暂存目录，再执行本脚本。
#
# 这个脚本只做一件事：把证书文件**原子地**换进 /etc/nginx/ssl/<域名>/，
# 换完跑 nginx -t，不通过就回滚到上一份，然后 reload。它不改 Nginx 配置——
# 「配置里怎么引用这些证书」由 deploy/server-setup.sh 负责（workflow 会在装完证书后重跑它）。
#
# 参数：
#   --domain <域名>   必填，证书要装的域名，也是目录名
#   --src <目录>      必填，暂存目录，里面要有 fullchain.pem + privkey.pem
#                     （也认腾讯云下载包解出来的 <域名>_bundle.crt + <域名>.key）
#   --base <目录>     证书根目录，默认 /etc/nginx/ssl
#   --no-reload       只装文件，不 reload nginx（调试用）
#   -h | --help       显示帮助
#
set -euo pipefail

DOMAIN=''
SRC=''
BASE='/etc/nginx/ssl'
RELOAD=1

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  # 用法文本从头部注释里现取：从第 3 行起逐行打印注释，遇到「-h | --help」那一行
  # 或第一行非注释就停，所以以后在头部加几行说明，--help 不会错位。
  # 末尾用 [[:space:]]\{0,1\} 而不是 \s\?：\s 和 \? 是 GNU sed 的扩展，
  # macOS 自带的 BSD sed 不认，那样会把注释里的 # 原样打出来。
  if [ -r "$0" ] && head -1 "$0" 2>/dev/null | grep -q '^#!'; then
    awk 'NR > 2 { if (/^#/) { print; if ($0 ~ /^#   -h \| --help/) exit } else exit }' "$0" \
      | sed 's/^#[[:space:]]\{0,1\}//'
  else
    cat <<'USAGE'
用法（在服务器上执行，脚本经 stdin 送到服务器）：
  ssh root@<公网IP> 'bash -s' -- --domain <域名> --src <暂存目录> < deploy/install-cert.sh

参数：
  --domain <域名>   必填，证书要装的域名，也是目录名
  --src <目录>      必填，暂存目录，里面要有 fullchain.pem + privkey.pem
  --base <目录>     证书根目录，默认 /etc/nginx/ssl
  --no-reload       只装文件，不 reload nginx（调试用）
  -h | --help       显示帮助
USAGE
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --src) SRC="${2:-}"; shift 2 ;;
    --base) BASE="${2:-}"; shift 2 ;;
    --no-reload) RELOAD=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（--help 查看用法）" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die '需要 root 权限：ssh root@<公网IP> 或用 sudo 运行'
[ -n "$DOMAIN" ] || die '缺少 --domain'
[ -n "$SRC" ] || die '缺少 --src（证书暂存目录）'
[ -d "$SRC" ] || die "暂存目录不存在：$SRC"
command -v openssl >/dev/null || die '缺少 openssl，先 apt-get install -y openssl'

DEST="$BASE/$DOMAIN"

# ---------------------------------------------------------------------------
# 1. 在暂存目录里找出证书链和私钥
# ---------------------------------------------------------------------------
# workflow 用统一名字；手动从腾讯云控制台下载解压出来的是 <域名>_bundle.crt / <域名>.key。
CERT_SRC=''
KEY_SRC=''
if [ -f "$SRC/fullchain.pem" ] && [ -f "$SRC/privkey.pem" ]; then
  CERT_SRC="$SRC/fullchain.pem"
  KEY_SRC="$SRC/privkey.pem"
else
  CERT_SRC=$(find "$SRC" -maxdepth 1 -type f \( -name '*.crt' -o -name '*.pem' \) ! -name 'privkey.pem' | head -1)
  KEY_SRC=$(find "$SRC" -maxdepth 1 -type f -name '*.key' | head -1)
fi
[ -n "$CERT_SRC" ] || die "$SRC 里找不到证书文件（*.crt / *.pem）"
[ -n "$KEY_SRC" ] || die "$SRC 里找不到私钥文件（*.key）"
log "证书：$CERT_SRC"
log "私钥：$KEY_SRC"

# ---------------------------------------------------------------------------
# 2. 先验一遍：证书能解析、域名对得上、私钥和证书是一对
#
# 这一步必须在覆盖旧证书之前做完。腾讯云偶尔会把不匹配的文件放进下载包，
# 或者 workflow 下错了域名，验完再装才不会把线上打挂。
# ---------------------------------------------------------------------------
openssl x509 -in "$CERT_SRC" -noout >/dev/null 2>&1 || die '证书文件不是合法的 PEM 证书'
openssl pkey -in "$KEY_SRC" -noout >/dev/null 2>&1 || die '私钥文件不是合法的 PEM 私钥'

if ! openssl x509 -in "$CERT_SRC" -noout -text | grep -qi "DNS:$DOMAIN"; then
  warn "证书里没有 DNS:$DOMAIN 这个域名（下面是对得上的域名清单）"
  openssl x509 -in "$CERT_SRC" -noout -text | grep -i 'DNS:' | tr ',' '\n' | sed 's/^\s*/    /'
  die '证书与 --domain 不匹配，拒绝安装'
fi

cert_pub=$(openssl x509 -in "$CERT_SRC" -noout -pubkey | openssl pkey -pubin -outform der 2>/dev/null | openssl dgst -sha256)
key_pub=$(openssl pkey -in "$KEY_SRC" -pubout -outform der 2>/dev/null | openssl dgst -sha256)
[ "$cert_pub" = "$key_pub" ] || die '私钥与证书不匹配（不是同一对），拒绝安装'
log '校验通过：域名匹配、私钥与证书成对'

CERT_END=$(openssl x509 -in "$CERT_SRC" -noout -enddate | cut -d= -f2)
log "新证书有效期至：$CERT_END"

# ---------------------------------------------------------------------------
# 3. 备份旧证书（有的话），装新证书
# ---------------------------------------------------------------------------
STAMP=$(date +%Y%m%d%H%M%S)
BACKUP=''
if [ -d "$DEST" ]; then
  BACKUP="$BASE/.backup/$DOMAIN-$STAMP"
  mkdir -p "$(dirname "$BACKUP")"
  cp -a "$DEST" "$BACKUP"
  log "已备份旧证书到 $BACKUP"
fi

# 先写同目录的临时文件再 mv，避免出现「证书换了、私钥还是旧的」这种半截状态
mkdir -p "$DEST"
install -m 644 "$CERT_SRC" "$DEST/fullchain.pem.new"
install -m 600 "$KEY_SRC" "$DEST/privkey.pem.new"
mv -f "$DEST/fullchain.pem.new" "$DEST/fullchain.pem"
mv -f "$DEST/privkey.pem.new" "$DEST/privkey.pem"

# ---------------------------------------------------------------------------
# 4. nginx -t 校验，不通过就回滚
# ---------------------------------------------------------------------------
if ! nginx -t; then
  warn 'nginx -t 没通过，回滚到上一份证书'
  if [ -n "$BACKUP" ]; then
    cp -a "$BACKUP/." "$DEST/"
    nginx -t || die '回滚后 nginx -t 仍然失败，请上服务器手动检查'
    warn "已回滚：$DEST 恢复为 $STAMP 之前的内容"
  else
    rm -rf "$DEST"
    nginx -t || die '移除新证书后 nginx -t 仍然失败，请上服务器手动检查'
    warn "已回滚：$DEST 已移除（原本就没有证书）"
  fi
  exit 1
fi

if [ "$RELOAD" -eq 1 ]; then
  systemctl reload nginx
  log 'nginx 已 reload，新证书生效'
else
  warn '按 --no-reload 跳过 reload，Nginx 还在用旧证书'
fi

log "指纹：$(openssl x509 -in "$DEST/fullchain.pem" -noout -fingerprint -sha256 | cut -d= -f2)"
log "域名：$(openssl x509 -in "$DEST/fullchain.pem" -noout -subject | sed 's/^subject=//')"
if [ -n "$BACKUP" ]; then
  log "如需回滚：cp -a $BACKUP/. $DEST/ && systemctl reload nginx"
fi
exit 0
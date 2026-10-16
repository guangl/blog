#!/usr/bin/env node
/**
 * 腾讯云免费 DV 证书的申请与续期（给 mainland ECS 那条通道用）。
 *
 * 为什么有这个脚本：腾讯云免费证书（TrustAsia C1 DV Free）是**单域名、3 个月**的，
 * 而且腾讯云的「自动部署」只覆盖它自家的云产品（CLB / CDN / DNSPod），管不到
 * ECS 上自建的 Nginx。所以要么每 3 个月手动换一次证书，要么把这套流程写成脚本。
 * 这个脚本走的是后者：用腾讯云 SSL API 申请、用 Cloudflare API 加 DNS 验证记录、
 * 拿到证书后解出 fullchain.pem + privkey.pem，交给 deploy/install-cert.sh 装。
 *
 * 流程（每个域名一遍）：
 *   1. DescribeCertificates 找该域名现有的已签发证书，算剩余天数；
 *      剩余天数够（默认 > 21 天）就直接跳过，不打任何写接口——定时任务可以天天跑。
 *   2. ApplyCertificate 申请免费证书（PackageType 83，有效期 3 个月）。
 *      证书快到期时带上 OldCertificateId，腾讯云会记一条续费关系。
 *   3. DescribeCertificateDetail 取 DV 验证信息（DvAuthKey / DvAuthValue）。
 *   4. 把 TXT 记录写进 Cloudflare（--zone，默认取域名后两段），
 *      再用 DNS-over-HTTPS 确认这条记录真的能查到，然后等它签发。
 *   5. DownloadCertificate 拿回一个 base64 的 ZIP，解出证书链和私钥，
 *      写成 <out>/<域名>/fullchain.pem 和 privkey.pem。
 *   6. 收尾时删掉自己加的 TXT 记录（只删带我们自己 comment 的那些，不动别人的）。
 *
 * 用法：
 *   node tools/ssl-renew.mjs                      # 检查 + 需要就续期
 *   node tools/ssl-renew.mjs --check              # 只看还剩几天，不申请
 *   node tools/ssl-renew.mjs --force              # 不管剩几天都重新申请
 *   node tools/ssl-renew.mjs --dry-run            # 打印将要做什么，不写任何东西
 *   node tools/ssl-renew.mjs --domains blog.guangluo.top,guangluo.top
 *   node tools/ssl-renew.mjs --out .cert-out --threshold 30 --timeout 45
 *   node tools/ssl-renew.mjs --json               # 结果以 JSON 输出到 stdout（日志走 stderr）
 *
 * 需要的环境变量：
 *   TENCENT_SECRET_ID / TENCENT_SECRET_KEY   腾讯云 CAM 密钥（要能调 SSL 证书接口）
 *   TENCENT_REGION                           可选，默认 ap-guangzhou（SSL 接口不分地域，随便给一个）
 *   CLOUDFLARE_DNS_TOKEN                     Cloudflare Token，权限 Zone → DNS → Edit
 *
 * 退出码：
 *   0  成功（包括「还没到期，跳过」）
 *   1  有域名续期失败
 *   2  参数或环境变量写错了
 *
 * 域名清单默认从 deploy/server-setup.sh 里读（DOMAIN + ALIASES 那两个默认值），
 * 也就是 Nginx 的 server_name 列表，避免同一个清单在三个地方各写一份。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import tencentcloud from 'tencentcloud-sdk-nodejs-ssl';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 腾讯云证书状态码（见 SDK 里 DescribeCertificateDetail 的 Status 字段）。
const STATUS = {
  0: '审核中', 1: '已通过', 2: '审核失败', 3: '已过期', 4: '自动添加DNS记录',
  5: '企业证书待提交资料', 6: '订单取消中', 7: '已取消', 8: '待上传确认函',
  9: '证书吊销中', 10: '已吊销', 11: '重颁发中', 12: '待上传吊销确认函',
  13: '免费证书待提交资料', 14: '已退款', 15: '证书迁移中'
};
// 走到这些状态就没救了，别再等：等下去只是白等超时。
const FAILED_STATUS = new Set([2, 6, 7, 9, 10, 13, 14]);
// TXT 记录的 comment，用来识别「这条记录是本脚本加的」，收尾时只删自己加的。
const TXT_COMMENT = 'tencent-ssl-validation (managed by tools/ssl-renew.mjs)';

const DEFAULTS = {
  threshold: 21,     // 剩余天数低于这个值才续期
  timeout: 30,       // 等签发的最长分钟数
  interval: 20,      // 轮询间隔（秒）
  out: '.cert-out'
};

// ---------------------------------------------------------------------------
// 命令行
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('--')));
const values = new Map();
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg.startsWith('--')) continue;
  const next = argv[i + 1];
  if (next && !next.startsWith('--')) {
    values.set(arg, next);
    i += 1;
  }
}
const dryRun = flags.has('--dry-run');
const json = flags.has('--json');
const checkOnly = flags.has('--check');
const force = flags.has('--force');

// 参数打错（--forcee 这种）不能悄悄当成没写：它会安静地少做或做错事情。
const KNOWN_FLAGS = new Set([
  '--check', '--force', '--dry-run', '--json', '--help',
  '--domains', '--out', '--zone', '--threshold', '--timeout', '--interval'
]);
for (const arg of argv) {
  if (arg.startsWith('--') && !KNOWN_FLAGS.has(arg)) die(`未知参数：${arg}（--help 查看用法）`);
}

// --json 时把日志赶到 stderr，stdout 只留 JSON，方便 workflow 解析。
const log = (...args) => (json ? console.error : console.log)(...args);
const warn = (...args) => console.warn(...args);

function usage() {
  const text = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const start = text.indexOf(' * 用法：');
  const end = text.indexOf(' */');
  console.log(text.slice(start, end).split('\n').map(line => line.replace(/^\s*\*\s?/, '')).join('\n'));
}

function die(message, code = 2) {
  console.error(`[x] ${message}`);
  process.exit(code);
}

if (argv.includes('--help') || argv.includes('-h')) {
  usage();
  process.exit(0);
}

const threshold = Number(values.get('--threshold') || DEFAULTS.threshold);
const timeoutMinutes = Number(values.get('--timeout') || DEFAULTS.timeout);
const intervalSeconds = Number(values.get('--interval') || DEFAULTS.interval);
const outDir = resolve(ROOT, values.get('--out') || DEFAULTS.out);

if (!Number.isFinite(threshold) || threshold < 0) die('--threshold 要是 0 或正整数（天）');
if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) die('--timeout 要大于 0（分钟）');

// ---------------------------------------------------------------------------
// 域名清单：默认从 deploy/server-setup.sh 的默认值里读
// ---------------------------------------------------------------------------
function domainsFromSetupScript() {
  const path = join(ROOT, 'deploy', 'server-setup.sh');
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const domain = /^DOMAIN='([^']*)'/m.exec(text)?.[1];
  const aliases = /^ALIASES='([^']*)'/m.exec(text)?.[1] || '';
  return [domain, ...aliases.split(/\s+/)].filter(Boolean);
}

const domains = (values.get('--domains') || '').split(',').map(s => s.trim()).filter(Boolean);
const domainList = domains.length > 0 ? domains : domainsFromSetupScript();
if (domainList.length === 0) {
  die('拿不到域名清单：deploy/server-setup.sh 里没有 DOMAIN，请用 --domains 指定');
}

// 证书要装在 Nginx 上，所以域名必须是干净的主机名，别把 URL 或端口传进来。
for (const domain of domainList) {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) {
    die(`域名不合法：${domain}`);
  }
}

// Cloudflare 的区域名：--zone 没给就取域名后两段（guangluo.top 这种没问题，
// 换成 com.cn / co.uk 这类多段后缀时要显式传 --zone）。
function zoneFor(domain) {
  const explicit = values.get('--zone');
  if (explicit) return explicit;
  return domain.split('.').slice(-2).join('.');
}

// ---------------------------------------------------------------------------
// 环境变量与客户端
// ---------------------------------------------------------------------------
const secretId = process.env.TENCENT_SECRET_ID || '';
const secretKey = process.env.TENCENT_SECRET_KEY || '';
const cfToken = process.env.CLOUDFLARE_DNS_TOKEN || '';

// 查证书列表就要密钥，所以腾讯云的密钥任何时候都必需；
// Cloudflare 的 Token 只有真的要写验证记录时才用得上。
if (!secretId || !secretKey) {
  die('缺少 TENCENT_SECRET_ID / TENCENT_SECRET_KEY（腾讯云 CAM 密钥）');
}
if (!dryRun && !checkOnly && !cfToken) {
  die('缺少 CLOUDFLARE_DNS_TOKEN（Cloudflare Token，权限 Zone → DNS → Edit）');
}

const SslClient = tencentcloud.ssl.v20191205.Client;
const client = new SslClient({
  credential: { secretId, secretKey },
  region: process.env.TENCENT_REGION || 'ap-guangzhou',
  profile: { http: { endpoint: 'ssl.tencentcloudapi.com', timeout: 60 } }
});

const sleep = seconds => new Promise(r => setTimeout(r, seconds * 1000));

// ---------------------------------------------------------------------------
// 腾讯云：查现有证书
// ---------------------------------------------------------------------------
const daysLeft = endTime => {
  if (!endTime) return -1;
  const time = Date.parse(endTime.replace(' ', 'T') + '+08:00');
  return Number.isFinite(time) ? (time - Date.now()) / 86400000 : -1;
};

/** 找该域名当前有效的服务器证书（可能有多张，取到期最晚的那张）。 */
async function findIssuedCertificate(domain) {
  const response = await client.DescribeCertificates({ Limit: 100, SearchKey: domain });
  const matches = (response.Certificates || [])
    .filter(c => c.CertificateType === 'SVR' && c.Status === 1)
    .filter(c => c.Domain === domain || (c.SubjectAltName || []).includes(domain))
    .sort((a, b) => Date.parse((b.CertEndTime || '').replace(' ', 'T')) - Date.parse((a.CertEndTime || '').replace(' ', 'T')));
  return matches[0] || null;
}

async function describe(certificateId) {
  return client.DescribeCertificateDetail({ CertificateId: certificateId });
}

// ---------------------------------------------------------------------------
// Cloudflare：加/删 DNS 验证记录
// ---------------------------------------------------------------------------
async function cf(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const detail = JSON.stringify(body.errors || body).slice(0, 300);
    throw new Error(`Cloudflare ${init.method || 'GET'} ${path} 失败：HTTP ${response.status} ${detail}`);
  }
  return body.result;
}

async function cfZoneId(zone) {
  const zones = await cf(`/zones?name=${encodeURIComponent(zone)}&status=active`);
  if (!zones || zones.length === 0) {
    throw new Error(`Cloudflare 里找不到区域 ${zone}：确认 Token 有该区域的 DNS 权限，多段后缀的域名要用 --zone 指定`);
  }
  return zones[0].id;
}

/** 我们之前跑失败/中断留下的同名校验记录，先清掉，避免 TXT 直接堆一串。 */
async function cfDropStaleTxt(zoneId, name) {
  const records = await cf(`/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(name)}`);
  const mine = (records || []).filter(r => (r.comment || '') === TXT_COMMENT);
  for (const record of mine) {
    await cf(`/zones/${zoneId}/dns_records/${record.id}`, { method: 'DELETE' });
    log(`  · 清掉上一次留下的 TXT 记录 ${name}`);
  }
}

async function cfAddTxt(zoneId, name, content) {
  const record = await cf(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'TXT', name, content, ttl: 60, comment: TXT_COMMENT })
  });
  return record.id;
}

async function cfDeleteTxt(zoneId, recordId) {
  try {
    await cf(`/zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' });
    return true;
  } catch (error) {
    warn(`  · 清理 TXT 记录失败（不影响证书，手动删一下即可）：${error.message}`);
    return false;
  }
}

/** 用 DNS-over-HTTPS 确认记录真的能查到：等签发之前先把「解析没生效」这个坑排掉。 */
async function txtIsVisible(name, value) {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`;
  const response = await fetch(url, { headers: { accept: 'application/dns-json' } });
  if (!response.ok) return false;
  const body = await response.json().catch(() => ({}));
  return (body.Answer || []).some(a => String(a.data || '').includes(value));
}

// ---------------------------------------------------------------------------
// ZIP：腾讯云的 DownloadCertificate 返回 base64 的 ZIP，这里只用 node:zlib 解
// ---------------------------------------------------------------------------
function unzip(buffer) {
  let eocd = -1;
  const floor = Math.max(0, buffer.length - 22 - 65535);
  for (let i = buffer.length - 22; i >= floor; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('DownloadCertificate 返回的不是 ZIP（找不到 EOCD）');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP 中央目录损坏');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;                 // 目录项
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP 本地头损坏：${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    // 0 = 不压缩，8 = deflate。腾讯云的包里是 deflate。
    if (method !== 0 && method !== 8) throw new Error(`ZIP 里 ${name} 用了不支持的压缩方式：${method}`);
    entries.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
  }
  return entries;
}

/** 从下载包里挑出 Nginx 要的两个文件：证书链 + 私钥。 */
function pickPemFiles(entries) {
  const names = [...entries.keys()];
  const inNginx = name => /nginx/i.test(name);
  const cert = names.find(n => inNginx(n) && /_bundle\.crt$/i.test(n))
    || names.find(n => /_bundle\.crt$/i.test(n))
    || names.find(n => /\.(crt|pem)$/i.test(n) && !/\.csr$/i.test(n) && !/\.key$/i.test(n));
  const key = names.find(n => inNginx(n) && /\.key$/i.test(n))
    || names.find(n => /\.key$/i.test(n));
  if (!cert) throw new Error(`下载包里找不到证书文件，只有：${names.join('、')}`);
  if (!key) throw new Error(`下载包里找不到私钥文件，只有：${names.join('、')}`);
  return { cert, key };
}

// ---------------------------------------------------------------------------
// 申请 + 验证 + 下载
// ---------------------------------------------------------------------------
async function waitForDvAuth(certificateId) {
  const deadline = Date.now() + timeoutMinutes * 60000;
  let last = '';
  while (Date.now() < deadline) {
    const detail = await describe(certificateId);
    const status = Number(detail.Status);
    if (status === 1) return { issued: true, detail };
    if (FAILED_STATUS.has(status)) {
      throw new Error(`申请没走下去：${STATUS[status] || status}${detail.StatusMsg ? `（${detail.StatusMsg}）` : ''}`);
    }
    const auth = detail.DvAuthDetail || {};
    if (auth.DvAuthKey && auth.DvAuthValue) {
      return { issued: false, detail, authKey: auth.DvAuthKey, authValue: auth.DvAuthValue };
    }
    const now = `${STATUS[status] || status}${detail.StatusMsg ? `/${detail.StatusMsg}` : ''}`;
    if (now !== last) { log(`  · 等待验证信息：${now}`); last = now; }
    await sleep(intervalSeconds);
  }
  throw new Error(`等 DV 验证信息超时（${timeoutMinutes} 分钟）`);
}

async function waitForIssued(certificateId) {
  const deadline = Date.now() + timeoutMinutes * 60000;
  let last = '';
  while (Date.now() < deadline) {
    const detail = await describe(certificateId);
    const status = Number(detail.Status);
    if (status === 1) return detail;
    if (FAILED_STATUS.has(status)) {
      throw new Error(`签发失败：${STATUS[status] || status}${detail.StatusMsg ? `（${detail.StatusMsg}）` : ''}`);
    }
    const now = `${STATUS[status] || status}${detail.StatusMsg ? `/${detail.StatusMsg}` : ''}`;
    if (now !== last) { log(`  · 等待签发：${now}`); last = now; }
    await sleep(intervalSeconds);
  }
  throw new Error(`等签发超时（${timeoutMinutes} 分钟），去腾讯云控制台看这张证书卡在哪一步`);
}

/** 下载证书并写成 Nginx 要的两个文件。 */
async function downloadInto(outDirForDomain, certificateId) {
  const response = await client.DownloadCertificate({ CertificateId: certificateId });
  if (!response.Content) throw new Error('DownloadCertificate 没返回内容');
  const entries = unzip(Buffer.from(response.Content, 'base64'));
  const { cert, key } = pickPemFiles(entries);

  mkdirSync(outDirForDomain, { recursive: true });
  const certPath = join(outDirForDomain, 'fullchain.pem');
  const keyPath = join(outDirForDomain, 'privkey.pem');
  writeFileSync(certPath, entries.get(cert), { mode: 0o644 });
  writeFileSync(keyPath, entries.get(key), { mode: 0o600 });
  return { certPath, keyPath, source: { cert, key } };
}

// ---------------------------------------------------------------------------
// 主流程
//
// 每个域名各自 try/catch：一个域名卡住不该把另外两个也拖下水，
// 失败的域名照常进结果里，最后统一报红。
// ---------------------------------------------------------------------------
const results = [];

async function main() {
  for (const domain of domainList) {
    const zone = zoneFor(domain);
    log(`\n=== ${domain}（Cloudflare 区域 ${zone}）===`);

    const record = { domain, action: 'renewed', certificateId: null, previousCertificateId: null };
    let zoneId = null;
    let txtRecordId = null;

    try {
      const existing = await findIssuedCertificate(domain);
      const left = existing ? daysLeft(existing.CertEndTime) : -1;
      if (existing) {
        log(`  现有证书 ${existing.CertificateId}，${existing.CertEndTime} 到期，还剩 ${left.toFixed(1)} 天`);
      } else {
        log('  没有找到已签发的证书');
      }

      if (checkOnly) {
        results.push({ domain, action: 'check', certificateId: existing?.CertificateId || null, daysLeft: Number(left.toFixed(1)) });
        continue;
      }
      if (!force && existing && left > threshold) {
        log(`  剩余天数高于 ${threshold} 天，跳过`);
        results.push({ domain, action: 'skipped', reason: `还剩 ${left.toFixed(1)} 天`, certificateId: existing.CertificateId, daysLeft: Number(left.toFixed(1)) });
        continue;
      }
      if (dryRun) {
        log(`  将申请一张新的免费证书（${existing ? `旧证书还剩 ${left.toFixed(1)} 天` : '首次申请'}）`);
        results.push({ domain, action: 'plan', certificateId: existing?.CertificateId || null, daysLeft: existing ? Number(left.toFixed(1)) : null });
        continue;
      }

      record.previousCertificateId = existing?.CertificateId || null;

      // 快到期时把旧证书带进申请，让腾讯云记一条续费关系（SDK：有效期 30 天内且未过期才允许）。
      const applyArgs = {
        DomainName: domain,
        DvAuthMethod: 'DNS',
        PackageType: '83',              // TrustAsia C1 DV Free
        ValidityPeriod: '3',
        Alias: domain
      };
      if (existing && left > 0 && left <= 30) applyArgs.OldCertificateId = existing.CertificateId;

      const applied = await client.ApplyCertificate(applyArgs);
      const certificateId = applied.CertificateId;
      record.certificateId = certificateId;
      log(`  已申请：${certificateId}`);

      const dv = await waitForDvAuth(certificateId);
      if (!dv.issued) {
        log(`  验证记录：${dv.authKey} = ${dv.authValue}`);
        zoneId = await cfZoneId(zone);
        await cfDropStaleTxt(zoneId, dv.authKey);
        txtRecordId = await cfAddTxt(zoneId, dv.authKey, dv.authValue);
        log(`  已写入 Cloudflare TXT（记录 ${txtRecordId}）`);

        // Cloudflare 是权威服务器，记录写进去就该立刻能查到；查不到通常是 Token
        // 写到了别的区域、或者域名其实不在这个账号下——先把这个坑排掉再等签发。
        let visible = false;
        for (let attempt = 1; attempt <= 10 && !visible; attempt += 1) {
          visible = await txtIsVisible(dv.authKey, dv.authValue);
          if (!visible) await sleep(6);
        }
        log(visible ? '  DNS 记录已能从公共解析查到' : '  [!] DNS 记录在公共解析里还看不到，仍继续等腾讯云自己重试');

        // 给腾讯云一个主动检查的机会：它返回的 LocalCheck 能直接告诉你记录看到没有。
        try {
          const checked = await client.CheckCertificateDomainVerification({ CertificateId: certificateId });
          for (const item of checked.VerificationResults || []) {
            const code = item.LocalCheck === 1 ? '通过' : `未通过（LocalCheck=${item.LocalCheck}${item.LocalCheckFailReason ? `，${item.LocalCheckFailReason}` : ''}）`;
            log(`  · 腾讯云自检 ${item.Domain}：${code}`);
          }
        } catch (error) {
          warn(`  · 腾讯云自检接口没成功（不致命）：${error.message}`);
        }
        await waitForIssued(certificateId);
        log('  已签发');
      }

      const written = await downloadInto(join(outDir, domain), certificateId);
      record.certPath = written.certPath;
      record.keyPath = written.keyPath;
      log(`  证书已写出：${written.certPath}`);
      log(`  私钥已写出：${written.keyPath}`);
      results.push(record);
    } catch (error) {
      record.action = 'failed';
      record.error = error.message;
      warn(`  [x] ${domain} 续期失败：${error.message}`);
      results.push(record);
    } finally {
      // 验证记录用完就删：留在 DNS 里没有意义，还会让下次申请多一条同名的 TXT。
      if (zoneId && txtRecordId) await cfDeleteTxt(zoneId, txtRecordId);
    }
  }
}

let fatal = null;
try {
  await main();
} catch (error) {
  fatal = error;
}

// ---------------------------------------------------------------------------
// 汇报
// ---------------------------------------------------------------------------
const failed = results.filter(r => r.action === 'failed');
if (json) {
  console.log(JSON.stringify({
    domains: results,
    renewed: results.filter(r => r.action === 'renewed').map(r => r.domain),
    failed: failed.map(r => r.domain),
    error: fatal ? fatal.message : null,
    dryRun,
    checkOnly
  }, null, 2));
} else {
  log('\n———————————————————————————');
  for (const r of results) {
    if (r.action === 'renewed') log(`${r.domain}：已换新证书（${r.certificateId}）`);
    else if (r.action === 'failed') log(`${r.domain}：失败——${r.error}`);
    else if (r.action === 'skipped') log(`${r.domain}：${r.reason}，跳过`);
    else if (r.action === 'check') log(`${r.domain}：还剩 ${r.daysLeft} 天`);
    else log(`${r.domain}：试运行，未申请`);
  }
  if (fatal) log(`中断：${fatal.message}`);
  log('———————————————————————————');
}

// 用 exitCode 而不是 process.exit()：让 stdout 把 JSON 写完再退出，
// 否则管道到文件时最后一段可能被截断。
process.exitCode = fatal || failed.length > 0 ? 1 : 0;

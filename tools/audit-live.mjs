#!/usr/bin/env node
/**
 * 线上站点定时体检（零依赖，只用 Node 标准库）
 *
 * 本地自检（`bun run verify:domain` + `tools/check-site.mjs`）检查的是**构建产物**，
 * 它管不到三件事：线上到底有没有真的发出安全响应头、证书还有几天到期、
 * 页面里的外链有没有烂掉。这个脚本补的就是这一段，直接打线上站点，分四部分给结论：
 *
 *   1. 可用性：页面清单来自线上 `sitemap.xml`（读不到就退回固定清单），逐个断言 200。
 *      网络类抖动（超时、连接被断）会补一次重试，免得偶发抖动把定时任务弄红。
 *   2. 安全响应头：期望值**从 `scripts/cloudflare-headers.js` 里现读**——那个构建期插件
 *      被放进 `node:vm` 沙箱跑一遍，交回它本来要写进 `_headers` 的 `/*` 段。
 *      也就是说头名与头值都以源文件为准，这里不抄字符串；源文件改了、线上没跟上就会红。
 *   3. TLS 证书：连 host:443 读 `getPeerCertificate()`，剩余不足 14 天算失败
 *      （Cloudflare 会自动续期，这条只是兜底）。连不上（CI 断网、被墙、端口不通）
 *      降级成告警，不让一次网络抖动把体检弄红。
 *   4. 外链死链：抓页面正文，收集所有 http(s) 外链（去掉本站域名、锚点、mailto），
 *      去重后并发检查（并发数不超过 5）。`404`/`410` 算失败；`401/403/405/429`、
 *      超时、DNS 失败、TLS 失败算**告警**——外部站点拦脚本客户端是常态，
 *      不该让体检变红。判定规则与理由见 docs/site-audit.md。
 *
 * 用法：
 *   node tools/audit-live.mjs                                   # 体检线上正式站点
 *   node tools/audit-live.mjs --base http://127.0.0.1:4001/      # 体检别的地址
 *   node tools/audit-live.mjs --json                             # 机器可读输出（只输出 JSON）
 *   node tools/audit-live.mjs --concurrency 3 --timeout 10000
 *   node tools/audit-live.mjs --help
 *
 * 退出码：
 *   0  没有失败（可能只有告警）
 *   1  有失败（页面不是 200 / 安全头不符 / 证书将过期 / 外链 404、410）
 *   2  参数写错了
 *
 * 不依赖任何第三方包，所以 CI 里不需要 `bun install`
 * （见 .github/workflows/site-audit.yml）。
 */

import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { connect as connectTls } from 'node:tls';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const DEFAULTS = {
  base: 'https://blog.guangluo.top/',
  concurrency: 5,
  timeout: 15000
};

// 外链检查的并发上限：对方不是自家 CDN，别拿并发去压别人。
const MAX_CONCURRENCY = 5;

// 一次体检最多打多少个页面。站点大了以后体检本身也不该跑成半小时，
// 超出的部分会明确告警提示，而不是悄悄少查。
const MAX_PAGES = 100;

// 证书剩余有效期低于这个天数就报警。Cloudflare 会自动续期，这里只防「自动续期失败没人发现」。
const TLS_MIN_DAYS = 14;

// sitemap 读不到时的兜底清单，都是构建自检里「必须存在」的路径（相对 --base）。
const REQUIRED_PATHS = ['posts/', 'about/', 'atom.xml', 'robots.txt', 'sitemap.xml'];

// 安全头名。只在「读不出 scripts/cloudflare-headers.js」时用来查「有没有」，
// 正常情况下头名和头值都从那两个文件里取。
const SECURITY_HEADER_NAMES = [
  'content-security-policy', 'strict-transport-security', 'x-content-type-options',
  'x-frame-options', 'referrer-policy', 'permissions-policy', 'cross-origin-resource-policy'
];

// 外站普遍按 UA 拦脚本客户端，用正常浏览器 UA，免得把「被拦」误判成「死链」。
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 外链判定：这几个状态码说明链接真的没了；其余 4xx/5xx 以及网络类错误一律先算告警。
const DEAD_LINK_STATUSES = new Set([404, 410]);
const BLOCKED_LINK_STATUSES = new Set([401, 403, 405, 429]);

// 证书本身有问题（过期 / 域名不匹配 / 自签）算失败；
// 其它握手失败（连不上、被中间设备打断）多半是网络不通，算告警。
const CERTIFICATE_ERROR = /^(?:CERT_|ERR_TLS_CERT|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT)/;

const SYMBOL = { pass: '✓', warn: '!', fail: '✗' };

const HEADERS_SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'cloudflare-headers.js');

class UsageError extends Error {}

const USAGE = `线上站点定时体检（零依赖）

用法：
  node tools/audit-live.mjs [选项]

选项：
  --base <url>         要体检的站点根地址，默认 ${DEFAULTS.base}
  --concurrency <n>    并发数（1-${MAX_CONCURRENCY}），默认 ${DEFAULTS.concurrency}
  --timeout <ms>       单个请求超时，默认 ${DEFAULTS.timeout}
  --json               输出机器可读的 JSON（不再打印人类可读清单）
  --help, -h           打印这段用法

检查内容：
  可用性（sitemap.xml 里的页面逐个断言 200）、安全响应头（期望值读自
  scripts/cloudflare-headers.js）、TLS 证书剩余有效期（少于 ${TLS_MIN_DAYS} 天算失败）、外链死链。

退出码：
  0 没有失败（可能只有告警）；1 有失败；2 参数写错了。`;

function parseArgs(argv) {
  const options = {
    base: DEFAULTS.base,
    concurrency: DEFAULTS.concurrency,
    timeout: DEFAULTS.timeout,
    json: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const separator = argument.startsWith('--') ? argument.indexOf('=') : -1;
    const name = separator > 0 ? argument.slice(0, separator) : argument;
    const inline = separator > 0 ? argument.slice(separator + 1) : null;
    const value = () => {
      const result = inline !== null ? inline : argv[++index];
      if (result === undefined) throw new UsageError(`${name} 后面缺一个值。`);
      return result;
    };
    if (name === '--help' || name === '-h') options.help = true;
    else if (name === '--json') options.json = true;
    else if (name === '--base') options.base = value();
    else if (name === '--concurrency') options.concurrency = Number(value());
    else if (name === '--timeout') options.timeout = Number(value());
    else throw new UsageError(`未知参数：${argument}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new UsageError(`--concurrency 需要是大于 0 的整数，收到 ${options.concurrency}。`);
  }
  if (!Number.isInteger(options.timeout) || options.timeout < 100 || options.timeout > 120000) {
    throw new UsageError(`--timeout 需要是 100-120000 之间的整数（毫秒），收到 ${options.timeout}。`);
  }
  // 外链并发硬性封顶，写死在脚本里而不是交给命令行。
  options.concurrencyRequested = options.concurrency;
  options.concurrency = Math.min(options.concurrency, MAX_CONCURRENCY);
  return options;
}

function normalizeBase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(`--base 不是合法 URL：${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UsageError(`--base 只支持 http/https：${value}`);
  }
  url.hash = '';
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

/** 把请求异常翻成一句能看懂的中文，超时 / DNS / TLS 都能看出来是哪一类。 */
function describeError(error, timeout) {
  if (!error) return '未知错误';
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return `超时（${timeout}ms）`;
  const cause = error.cause || {};
  const code = cause.code || error.code;
  const message = cause.message || error.message || String(error);
  return code && !message.includes(code) ? `${message}（${code}）` : message;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" };

function decodeEntities(value) {
  return value.replace(/&(#?\w+);/g, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

/** 并发跑一批任务，`worker` 必须自己把异常吞掉，别让整个体检崩在一条外链上。 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * 从 `scripts/cloudflare-headers.js` 取安全响应头的真值。
 *
 * 那是个构建期 Hexo 插件（CommonJS，靠全局 `hexo` 注册 after_generate 钩子，
 * 钩子里把内容写进 `public/_headers`），所以没法直接 import。
 * 这里在 `node:vm` 沙箱里喂一个假的 `hexo` 和一个假的 `fs`，让插件把本来要写盘的内容
 * 交出来，再解析 `/*` 那一段。这样「线上该有什么头、值是什么」永远跟着源文件走，
 * 不会出现脚本里抄了一份 CSP、源文件改了却没人发现的情况。
 */
function loadExpectedHeaders(file) {
  const captured = { text: null, filter: null };
  const sandbox = {
    hexo: {
      public_dir: resolve(dirname(file), '..', 'public'),
      extend: { filter: { register(_name, callback) { captured.filter = callback; } } }
    },
    require(name) {
      if (name === 'fs' || name === 'node:fs') {
        // 只拦写文件：内容留在内存里，体检不去碰工作区。
        return { mkdirSync() {}, writeFileSync(_path, content) { captured.text = String(content); } };
      }
      if (name === 'path' || name === 'node:path') return { join };
      throw new Error(`沙箱没有提供 ${name}`);
    },
    console
  };
  vm.runInNewContext(readFileSync(file, 'utf8'), sandbox, { filename: file });
  if (typeof captured.filter !== 'function') throw new Error('插件没有注册 after_generate 钩子');
  captured.filter();
  if (!captured.text) throw new Error('插件没有写出 _headers 内容');
  const block = parseHeadersFile(captured.text).find(item => item.pattern === '/*');
  if (!block) throw new Error('_headers 里没有 /* 段');
  return block.headers;
}

/** 解析 Cloudflare Pages 的 `_headers`，形态与 tools/check-site.mjs 里那份一致。 */
function parseHeadersFile(text) {
  return text.split(/\n\s*\n/).map(block => {
    const lines = block.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'));
    const [pattern, ...rest] = lines;
    const headers = {};
    for (const line of rest) {
      const separator = line.indexOf(':');
      if (separator > 0) headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }
    return { pattern: (pattern || '').trim(), headers };
  }).filter(block => block.pattern);
}

/** 取页面清单：优先线上 sitemap.xml，读不到或为空时退回固定清单。 */
async function collectPages(base, timeout) {
  const required = [base.href, ...REQUIRED_PATHS.map(path => new URL(path, base).href)];
  const sitemapUrl = new URL('sitemap.xml', base).href;
  const warnings = [];
  const found = [];
  let skipped = 0;
  try {
    const response = await fetch(sitemapUrl, {
      headers: { 'user-agent': BROWSER_UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      let url;
      try {
        url = new URL(decodeEntities(match[1]));
      } catch {
        skipped += 1;
        continue;
      }
      // 只查本站：sitemap 里出现别的域名说明配置有问题，但体检不该跑去打别人的站。
      if (url.origin !== base.origin) {
        skipped += 1;
        continue;
      }
      url.hash = '';
      found.push(url.href);
    }
    if (found.length === 0) {
      warnings.push(`线上 ${sitemapUrl} 里没有可用的本站 URL，改用固定清单。`);
    }
    if (skipped > 0) warnings.push(`sitemap.xml 里有 ${skipped} 条不是本站或无法解析的 URL，已跳过。`);
  } catch (error) {
    warnings.push(`读不到线上 sitemap.xml（${describeError(error, timeout)}），改用固定清单。`);
  }
  let pages = [...new Set([...required, ...found])];
  if (pages.length > MAX_PAGES) {
    warnings.push(`页面清单有 ${pages.length} 条，超过单次上限 ${MAX_PAGES} 条，只查前 ${MAX_PAGES} 条（其余未检查）。`);
    pages = pages.slice(0, MAX_PAGES);
  }
  return { pages, sitemapUrl, sitemapCount: found.length, warnings };
}

/** 请求一个页面，断言 200；正文留着给外链检查用。任何异常都归类返回，不往外抛。 */
async function probePage(url, timeout) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': BROWSER_UA, accept: '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout)
    });
    const headers = Object.fromEntries([...response.headers].map(([name, value]) => [name.toLowerCase(), value]));
    const contentType = headers['content-type'] || '';
    // 只把文本类正文读进来（HTML / XML / JSON / txt），图片之类的直接掐掉连接，别白下流量。
    const isText = !contentType || /(?:text\/|json|xml|xhtml)/i.test(contentType);
    const body = isText ? await response.text() : (response.body ? (await response.body.cancel(), null) : null);
    return {
      url,
      status: response.status,
      level: response.status === 200 ? 'pass' : 'fail',
      elapsedMs: Date.now() - started,
      headers,
      body,
      error: response.status === 200 ? undefined : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      url,
      status: null,
      level: 'fail',
      elapsedMs: Date.now() - started,
      headers: {},
      body: null,
      error: describeError(error, timeout)
    };
  }
}

/**
 * 页面可用性检查。
 *
 * 只有「压根没拿到状态码」（超时、连接被断、DNS 抖动）才补一次：这类是网络抖动，
 * 一次重试就能把偶发红挡掉；拿到非 200 状态码是确定性结论，不重试。
 */
async function probePageWithRetry(url, timeout) {
  const first = await probePage(url, timeout);
  if (first.status !== null) return first;
  const second = await probePage(url, timeout);
  return { ...second, retried: true, error: `${second.error}（重试一次后仍失败）` };
}

/** 收集页面里的外链：只认绝对的 http(s) 链接，本站域名与锚点都排掉。 */
function extractExternalLinks(body, base) {
  const links = new Set();
  const pattern = /(?<![\w-])(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const match of body.matchAll(pattern)) {
    const raw = decodeEntities(match[1] ?? match[2] ?? '').trim();
    if (!/^https?:\/\//i.test(raw)) continue;
    let url;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.hostname.toLowerCase() === base.hostname.toLowerCase()) continue;
    url.hash = ''; // 同一页面上指向同一个地址的不同锚点只查一次
    links.add(url.href);
  }
  return [...links];
}

/** 检查一条外链。404/410 失败，受限状态码与网络类错误算告警，2xx/3xx 通过。 */
async function probeLink(url, timeout) {
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': BROWSER_UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout)
    });
    await response.body?.cancel();
    const status = response.status;
    const level = status >= 200 && status < 400 ? 'pass'
      : DEAD_LINK_STATUSES.has(status) ? 'fail'
        : 'warn';
    const reason = level === 'pass' ? undefined
      : level === 'fail' ? '链接已失效'
        : BLOCKED_LINK_STATUSES.has(status) ? '外部站点可能拦脚本客户端' : '响应状态异常';
    return {
      url,
      status,
      level,
      reason: reason ? `${reason}（HTTP ${status}）` : undefined,
      finalUrl: response.url && response.url !== url ? response.url : undefined
    };
  } catch (error) {
    // 超时 / DNS / TLS 都算告警：外站拦脚本客户端是常态，不该让体检变红。
    return { url, status: null, level: 'warn', reason: describeError(error, timeout) };
  }
}

/** 连 host:443 看证书剩余有效期。连不上就优雅降级成告警，不抛栈。 */
function probeTls(host, timeout) {
  return new Promise(done => {
    let settled = false;
    let socket = null;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (socket) socket.destroy();
      done(result);
    };
    try {
      socket = connectTls({
        host,
        port: 443,
        servername: isIP(host) ? undefined : host,
        timeout
      });
    } catch (error) {
      finish({ level: 'warn', host, message: `无法建立 TLS 连接，跳过证书检查：${describeError(error, timeout)}` });
      return;
    }
    socket.on('secureConnect', () => {
      try {
        const certificate = socket.getPeerCertificate();
        if (!certificate || !certificate.valid_to) {
          finish({ level: 'warn', host, message: '拿不到证书信息，跳过证书检查。' });
          return;
        }
        const expiresAt = new Date(certificate.valid_to);
        const daysRemaining = (expiresAt.getTime() - Date.now()) / 86400000;
        const rounded = Math.floor(daysRemaining);
        finish({
          level: daysRemaining < TLS_MIN_DAYS ? 'fail' : 'pass',
          host,
          daysRemaining: rounded,
          validTo: expiresAt.toISOString(),
          issuer: certificate.issuer && (certificate.issuer.O || certificate.issuer.CN),
          message: daysRemaining < TLS_MIN_DAYS
            ? `证书只剩 ${rounded} 天到期（${expiresAt.toISOString()}），低于 ${TLS_MIN_DAYS} 天的底线。`
            : `证书剩余 ${rounded} 天（${expiresAt.toISOString()} 到期）。`
        });
      } catch (error) {
        finish({ level: 'warn', host, message: `读取证书信息失败，跳过证书检查：${describeError(error, timeout)}` });
      }
    });
    socket.on('timeout', () => {
      finish({ level: 'warn', host, message: `连接 ${host}:443 超时（${timeout}ms），跳过证书检查。` });
    });
    socket.on('error', error => {
      const code = error.code || '';
      const certificateProblem = CERTIFICATE_ERROR.test(code);
      finish({
        level: certificateProblem ? 'fail' : 'warn',
        host,
        message: certificateProblem
          ? `TLS 握手失败，证书本身有问题：${describeError(error, timeout)}`
          : `无法建立 TLS 连接，跳过证书检查：${describeError(error, timeout)}`
      });
    });
  });
}

/** 指出两份头值第一处不同，只截一小段，避免把整条 CSP 刷满屏幕。 */
function firstDifference(expected, actual) {
  if (actual === undefined) return '线上没有这个头';
  let index = 0;
  while (index < expected.length && index < actual.length && expected[index] === actual[index]) index += 1;
  const window = (text, from) => text.slice(Math.max(0, from - 20), from + 40);
  return `第 ${index + 1} 个字符起不同：源文件「…${window(expected, index)}…」，线上「…${window(actual, index)}…」`;
}

function countByLevel(entries) {
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const entry of entries) counts[entry.level] += 1;
  return counts;
}

function printReport(report) {
  const { sections, summary } = report;
  console.log(`线上体检 ${report.base}`);
  console.log(`开始时间 ${report.startedAt}｜并发 ${report.options.concurrency}｜超时 ${report.options.timeout}ms｜耗时 ${report.durationMs}ms`);
  for (const warning of [...report.warnings, ...report.sitemap.warnings]) console.log(`  ! ${warning}`);

  console.log('');
  console.log(`[1/4] 可用性（页面清单取自 ${report.sitemap.url}，共 ${report.sitemap.urls} 条，检查 ${sections.pages.length} 个）`);
  for (const page of sections.pages) {
    console.log(`  ${SYMBOL[page.level]} ${page.status ?? '---'}  ${page.url}  ${page.elapsedMs}ms${page.error ? `  ${page.error}` : ''}`);
  }

  console.log('');
  console.log(`[2/4] 安全响应头（期望值读自 scripts/cloudflare-headers.js 的 /* 段）`);
  if (sections.headersNote) console.log(`  ! ${sections.headersNote}`);
  for (const header of sections.headers) {
    console.log(`  ${SYMBOL[header.level]} ${header.name}  ${header.message}`);
  }

  console.log('');
  console.log('[3/4] TLS 证书');
  console.log(`  ${SYMBOL[sections.tls.level]} ${sections.tls.message}`);

  console.log('');
  console.log(`[4/4] 外链（去重后 ${sections.links.length} 条${sections.linksNote ? `，${sections.linksNote}` : ''}）`);
  if (sections.links.length === 0) console.log('  · 没有需要检查的外链。');
  for (const link of sections.links) {
    console.log(`  ${SYMBOL[link.level]} ${link.status ?? '---'}  ${link.url}${link.reason ? `  ${link.reason}` : ''}`);
  }

  console.log('');
  console.log(`汇总：通过 ${summary.pass} 条，告警 ${summary.warn} 条，失败 ${summary.fail} 条`);
  if (summary.fail > 0) console.log(`体检不通过：有 ${summary.fail} 条失败，逐条见上面带 ✗ 的行。`);
  else if (summary.warn > 0) console.log('体检通过：告警不拦（外站拦脚本客户端属正常），需要时人工确认上面带 ! 的行。');
  else console.log('体检通过：没有失败，也没有告警。');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const startedAt = new Date();
  const base = normalizeBase(options.base);
  const warnings = [];

  if (options.concurrencyRequested > MAX_CONCURRENCY) {
    warnings.push(`并发数上限是 ${MAX_CONCURRENCY}，已从 ${options.concurrencyRequested} 收到 ${MAX_CONCURRENCY}。`);
  }

  // 1) 页面清单与可用性
  const collected = await collectPages(base, options.timeout);
  const pageResults = await mapLimit(collected.pages, options.concurrency, url => probePageWithRetry(url, options.timeout));

  // 2) 安全响应头：拿首页那次响应来比
  const headerChecks = [];
  let headersNote = null;
  let expected = null;
  try {
    expected = loadExpectedHeaders(HEADERS_SOURCE);
  } catch (error) {
    headersNote = `读不出 scripts/cloudflare-headers.js 的期望值（${error.message}），本次只检查响应头是否存在，不比对取值。`;
  }
  const rootUrl = base.href;
  const root = pageResults.find(page => page.url === rootUrl);
  if (!root || root.status === null) {
    headerChecks.push({
      name: '(首页)',
      level: 'fail',
      message: `首页 ${rootUrl} 请求失败（${(root && root.error) || '没有响应'}），无法核对安全响应头。`
    });
  } else {
    // `/*` 上本来就不该有 Cache-Control（tools/check-site.mjs 守着这条）；真出现了也不比对，
    // 因为 Cloudflare 命中多条规则时会把同一个头的值用逗号拼起来，逐字符比没有意义。
    const pairs = expected
      ? Object.entries(expected).filter(([name]) => name !== 'cache-control')
      : SECURITY_HEADER_NAMES.map(name => [name, null]);
    for (const [name, value] of pairs) {
      const actual = root.headers[name];
      if (!actual) {
        headerChecks.push({ name, level: 'fail', expected: value ?? undefined, message: '首页响应里没有这个头。' });
      } else if (value !== null && actual !== value) {
        headerChecks.push({ name, level: 'fail', expected: value, actual, message: `与源文件不一致：${firstDifference(value, actual)}` });
      } else {
        headerChecks.push({
          name,
          level: 'pass',
          expected: value ?? undefined,
          actual,
          message: value === null ? '已发出（本次未比对取值）。' : '与 scripts/cloudflare-headers.js 一致。'
        });
      }
    }
  }

  // 3) TLS 证书
  let tls;
  if (base.protocol !== 'https:') {
    tls = { level: 'warn', host: base.hostname, message: `--base 不是 https（${base.protocol}），跳过证书检查。` };
  } else {
    tls = await probeTls(base.hostname, options.timeout);
  }

  // 4) 外链
  const external = [...new Set(pageResults
    .filter(page => page.body)
    .flatMap(page => extractExternalLinks(page.body, base)))].sort();
  const linkResults = await mapLimit(external, options.concurrency, url => probeLink(url, options.timeout));
  const linkWarnings = [];
  const failedPages = pageResults.filter(page => page.status === null);
  if (failedPages.length > 0) {
    linkWarnings.push(`${failedPages.length} 个页面没抓到正文，这些页面里的外链这次没查到`);
  }
  if (external.length > MAX_PAGES * 10) {
    linkWarnings.push(`外链偏多（${external.length} 条），体检耗时可能较长`);
  }

  const sections = {
    // 正文（HTML）不放进报告：默认输出不该刷屏，--json 也不该塞进整页 HTML。
    pages: pageResults.map(({ body, ...rest }) => rest),
    headers: headerChecks,
    headersNote,
    tls,
    links: linkResults,
    linksNote: linkWarnings.join('；') || undefined
  };
  const summary = countByLevel([...headerChecks, tls, ...pageResults, ...linkResults]);
  const report = {
    base: base.href,
    host: base.host,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    options: { concurrency: options.concurrency, timeout: options.timeout },
    sitemap: {
      url: collected.sitemapUrl,
      urls: collected.sitemapCount,
      pages: collected.pages.length,
      warnings: collected.warnings
    },
    warnings,
    sections,
    summary,
    ok: summary.fail === 0
  };

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  return summary.fail > 0 ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`参数错误：${error.message}`);
    console.error('用 node tools/audit-live.mjs --help 看用法。');
    process.exitCode = 2;
  } else {
    console.error(`体检没跑完：${error.message}`);
    process.exitCode = 1;
  }
}

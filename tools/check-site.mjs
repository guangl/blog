import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep, dirname } from 'node:path';
import { load } from 'cheerio';
import yaml from 'js-yaml';
import hexoUtil from 'hexo-util';

const { unescapeHTML } = hexoUtil;

const config = Object.assign({}, ...['_config.yml', ...process.argv.slice(2)]
  .map(path => yaml.load(readFileSync(path, 'utf8'))));
const output = resolve(config.public_dir);
const site = new URL(config.url.replace(/\/?$/, '/'));
const errors = [];
const report = (condition, message) => { if (!condition) errors.push(message); };

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

// 把 URL 路径统一解码，便于和主题输出的裸 Unicode 路径比较；
// 非法转义序列保持原样，交给后续比较报错。
function decodeURIPath(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    url.pathname = decodeURI(url.pathname);
    return url.href;
  } catch {
    return value;
  }
}

function localTarget(value, base, context) {
  if (!value || /^(?:#|data:|mailto:|tel:|javascript:)/i.test(value)) return;
  const url = new URL(value, base);
  if (url.origin !== site.origin) return;
  if (url.pathname === config.root.replace(/\/$/, '')) url.pathname += '/';
  report(url.pathname.startsWith(config.root), `${context}: link leaves ${config.root}: ${value}`);
  if (!url.pathname.startsWith(config.root)) return;
  const target = resolve(output, decodeURIComponent(url.pathname.slice(config.root.length)));
  report(target === output || target.startsWith(output + sep), `${context}: path escapes output: ${value}`);
  if (!existsSync(target)) {
    errors.push(`${context}: missing local target: ${value}`);
  } else if (statSync(target).isDirectory()) {
    report(existsSync(resolve(target, 'index.html')), `${context}: missing directory index: ${value}`);
  }
}

assert(existsSync(output), 'Run bun run build before checking the site.');
for (const path of ['index.html', 'posts/index.html', 'about/index.html', 'subscribe/index.html', 'archives/index.html',
  'categories/index.html', 'tags/index.html', 'examples/index.html',
  '404.html', 'atom.xml', 'search.json', 'sitemap.xml', 'robots.txt',
  'favicon.ico', 'apple-touch-icon.png', '_headers']) {
  report(existsSync(resolve(output, path)), `Missing required page: ${path}`);
}

// 首页 Hero 的标题来自 source/_data/wiki/home.yml 的 headline。
// 这里从数据文件读期望值，而不是把文案硬编码进自检——否则每次改标题都会误报一次。
const homeHeadline = ((yaml.load(readFileSync('source/_data/wiki/home.yml', 'utf8')) || {}).headline || '').trim();

const pages = files(output).filter(path => path.endsWith('.html'));
const articles = [];
for (const file of pages) {
  const path = relative(output, file).split(sep).join('/');
  const url = new URL(path, site);
  const raw = readFileSync(file, 'utf8');
  const $ = load(raw);
  report(!unescapeHTML(raw).includes('https://guangl.github.io/blog'), `${path}: stale GitHub Pages URL`);
  report(Boolean($('title').text().trim()), `${path}: missing title`);
  report(Boolean($('meta[name="description"]').attr('content')), `${path}: missing description`);
  // scripts/canonical-notice.js 关掉了主题的「非法克隆站 / 官方备用站」浮层，
  // 每个页面都必须带上那段内联脚本，否则备用入口上又会弹出提示并插 noindex。
  report(raw.includes('data-stellar-no-canonical-tip'), `${path}: missing the canonical-notice opt-out script`);
  if (path === 'index.html') {
    report(Boolean(homeHeadline) && $('.wiki-hero h1').text().trim() === homeHeadline,
      'Native homepage hero is missing or does not show the configured headline');
    report($('.wiki-hero a[href="#start"]').length > 0 && $('#start').length === 1, 'Homepage reading anchor is missing');
    // `inject.head_end` 里的图标链接与 Hero 对比度遮罩，删了就要在这里报出来
    report($('link[rel="icon"][href="/favicon.ico"]').length === 1, 'Homepage is missing the /favicon.ico icon link');
    report($('link[rel="apple-touch-icon"][href="/apple-touch-icon.png"]').length === 1,
      'Homepage is missing the apple-touch-icon link');
    report(raw.includes('--text-banner: #fff !important'),
      'Homepage is missing the hero contrast override (inject.head_end)');
  }
  report($('main, [role="main"]').length === 1, `${path}: missing main landmark`);
  report(($('meta[name="viewport"]').attr('content') || '').includes('width=device-width'), `${path}: missing responsive viewport`);
  // 缩放：`maximum-scale` / `user-scalable` 会禁掉双指缩放，WCAG 1.4.4 不达标。
  // 主题把它写死在 head.ejs，由 scripts/a11y.js 在产物上去掉，这里守住结果。
  const viewport = $('meta[name="viewport"]').attr('content') || '';
  report(!/(?:maximum-scale|minimum-scale|user-scalable)/i.test(viewport),
    `${path}: viewport blocks zooming: ${viewport}`);
  // 键盘用户要能跳过顶栏和 Hero 直接到正文（WCAG 2.4.1）。目标 #main 必须带
  // tabindex="-1"，否则部分浏览器只滚动、不移动焦点。
  const skipLink = $('a.a11y-skip-link');
  report(skipLink.length === 1, `${path}: expected exactly one skip link, found ${skipLink.length}`);
  report(skipLink.attr('href') === '#main', `${path}: skip link must point at #main`);
  report($('#main').attr('tabindex') === '-1', `${path}: skip link target #main needs tabindex="-1"`);
  // skip link 本身也得是页面里第一个可聚焦元素，否则先按 Tab 还是落在顶栏上。
  const focusable = $('body a[href], body button, body input, body select, body textarea, body [tabindex]');
  report(focusable.length > 0 && focusable.first().is('a.a11y-skip-link'),
    `${path}: skip link must be the first focusable element in <body>`);
  // 社交卡片：图片不能被兜底成站点头像（1:1、280px），卡片类型要是大图卡片。
  const ogImage = ($('meta[property="og:image"]').attr('content') || '').trim();
  const avatar = new URL(config.avatar, site).href;
  report(ogImage.length > 0, `${path}: missing og:image`);
  report(/^https?:\/\//.test(ogImage), `${path}: og:image must be an absolute URL: ${ogImage}`);
  report(ogImage !== avatar, `${path}: og:image falls back to the site avatar: ${ogImage}`);
  report(($('meta[name="twitter:card"]').attr('content') || '') === 'summary_large_image',
    `${path}: twitter:card should be summary_large_image`);
  // 无障碍：每页恰好一个 h1（scripts/a11y.js 负责把多出来的降级成 h2、
  // 给列表页补视觉隐藏的 h1），且每张图都必须有 alt 属性——alt="" 表示装饰性图片，
  // 与「完全没有 alt」在无障碍树里是两回事。
  const h1List = $('h1');
  report(h1List.length === 1, `${path}: expected exactly one h1, found ${h1List.length}`);
  const imagesWithoutAlt = $('img').filter((_, image) => $(image).attr('alt') === undefined);
  report(imagesWithoutAlt.length === 0,
    `${path}: ${imagesWithoutAlt.length} image(s) without an alt attribute`);
  // 图片优化管线：改写过的图必须是 <picture> + srcset，且带尺寸（避免 CLS）
  $('picture > img').each((_, image) => {
    const $image = $(image);
    report(Boolean($image.attr('srcset')), `${path}: <picture> img without srcset: ${$image.attr('src')}`);
    report(Boolean($image.attr('width')) && Boolean($image.attr('height')),
      `${path}: <picture> img without width/height: ${$image.attr('src')}`);
    report($(image).attr('loading') === 'lazy' || $(image).attr('loading') === 'eager',
      `${path}: <picture> img without native loading: ${$image.attr('src')}`);
    report(!$image.attr('data-src'), `${path}: <picture> img still carries the theme's data-src`);
  });
  // SEO：作者 CDN 的占位图不应出现在页面里（应使用本站 fallbacks.cover / avatar）
  report(!raw.includes('cdn-x/placeholder'), `${path}: references theme author placeholder CDN`);
  // SEO：结构化数据的图片必须是绝对 URL，schema.org 不接受相对路径
  for (const block of $('script[type="application/ld+json"]').toArray()) {
    let data;
    try { data = JSON.parse($(block).text()); } catch { continue; }
    for (const item of (Array.isArray(data) ? data : [data])) {
      if (!item || item['@type'] !== 'BlogPosting') continue;
      const images = Array.isArray(item.image) ? item.image : item.image ? [item.image] : [];
      for (const image of images) {
        const value = typeof image === 'string' ? image : image && image.url;
        if (typeof value === 'string' && value.length > 0) {
          report(/^https?:\/\//.test(value), `${path}: structured data image is not absolute: ${value}`);
        }
      }
    }
  }
  const canonical = $('link[rel="canonical"]');
  if (path !== '404.html') {
    report(canonical.length === 1, `${path}: expected one canonical URL`);
    // 主题输出裸 Unicode 路径，new URL() 会做百分号编码；两者语义相同，比较时统一解码。
    report(decodeURIPath(canonical.attr('href')) === decodeURIPath(new URL(path.replace(/index\.html$/, ''), site).href),
      `${path}: incorrect canonical URL`);
  } else {
    report(canonical.length === 0, '404 page must not have a canonical URL');
    report(['none', 'noindex', 'noindex, nofollow'].includes($('meta[name="robots"]').attr('content')), '404 page must not be indexed');
  }
  $('a[href], link[href], script[src], img[src], img[data-src], source[srcset]').each((_, element) => {
    for (const attribute of ['href', 'src', 'data-src']) {
      localTarget($(element).attr(attribute), url, path);
    }
  });
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const data = JSON.parse($(element).text());
      if (data['@type'] === 'BlogPosting') articles.push(data);
    }
    catch { errors.push(`${path}: invalid structured data`); }
  });
  report(!$('body').text().includes('CC BY-NC-SA'), `${path}: license conflicts with repository CC BY 4.0`);
}

const search = JSON.parse(readFileSync(resolve(output, 'search.json'), 'utf8'));
for (const entry of search) localTarget(entry.path, site, 'search.json');
for (const article of articles) {
  report(search.some(entry => entry.title === article.headline && entry.path === new URL(article.url).pathname),
    `Article missing from search: ${article.headline}`);
}
report(search.some(entry => entry.path === config.root + 'about/'), 'About page missing from search');

const feed = load(readFileSync(resolve(output, 'atom.xml'), 'utf8'), { xmlMode: true });
report(feed('feed > entry').length > 0, 'Atom feed has no entries');
feed('entry > link').each((_, entry) => localTarget(feed(entry).attr('href'), site, 'atom.xml'));
report(Boolean(feed('entry > content').text().trim()), 'Atom feed is missing article content');
report(feed('feed > rights').text().includes('CC BY 4.0'), 'Atom rights conflict with site license');
feed('entry').each((_, element) => {
  const entry = feed(element);
  const base = entry.attr('xml:base');
  report(Boolean(base), 'Atom entry needs a base URL for relative article assets');
  const content = entry.children('content');
  report(content.attr('type') === 'html', 'Atom full content must be marked as HTML');
  const article = load(content.text());
  article('a[href], img[src]').each((_, asset) => {
    localTarget(article(asset).attr('href') || article(asset).attr('src'), base || site, 'Atom content');
  });
});

const sitemap = load(readFileSync(resolve(output, 'sitemap.xml'), 'utf8'), { xmlMode: true });
sitemap('loc').each((_, element) => localTarget(sitemap(element).text(), site, 'sitemap.xml'));
const sitemapUrls = sitemap('loc').toArray().map(element => sitemap(element).text().trim());
report(sitemapUrls.length > 0, 'sitemap.xml has no URLs');
report(sitemapUrls.includes(site.href), 'sitemap.xml is missing the homepage');
// 重复 URL 会浪费抓取配额，IndexNow 也会把同一条提交两次；模板改动最容易在这里翻车。
const duplicatedSitemapUrls = sitemapUrls.filter((url, index) => sitemapUrls.indexOf(url) !== index);
report(duplicatedSitemapUrls.length === 0,
  `sitemap.xml has duplicate URLs: ${[...new Set(duplicatedSitemapUrls)].join(', ')}`);
const robotsText = readFileSync(resolve(output, 'robots.txt'), 'utf8');
report(robotsText.includes(new URL('sitemap.xml', site).href), 'robots.txt has wrong sitemap URL');

// robots.txt 的抓取策略：默认封禁、搜索引擎与 AI 搜索放行、AI 训练与数据采集拒绝。
// 改策略时这里的期望值要一起改；只做「组是否被整体放行/封禁」的粗粒度判断。
function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      // 连续多个 User-agent 属于同一组；已经写过规则则另起一组。
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (key === 'allow' || key === 'disallow')) {
      current.rules.push({ key, value });
    }
  }
  return groups;
}

const robotsGroups = parseRobots(robotsText);
const robotsGroup = agent => robotsGroups.find(group => group.agents.includes(agent));
const robotsBlocksAll = group => group.rules.some(rule => rule.key === 'disallow' && rule.value === '/');
const robotsAllowsAll = group => group.rules.some(rule => rule.key === 'allow' && rule.value === '/');

const defaultRobotsGroup = robotsGroup('*');
report(!!defaultRobotsGroup && robotsBlocksAll(defaultRobotsGroup),
  'robots.txt must block every crawler by default (User-agent: * / Disallow: /)');
for (const agent of ['googlebot', 'bingbot', 'baiduspider']) {
  const group = robotsGroup(agent);
  report(!!group && robotsAllowsAll(group) && !robotsBlocksAll(group),
    `robots.txt must allow the ${agent} search crawler`);
}
// 「可以引用我、不要拿去训练」是这份策略的核心取舍：AI 搜索与用户触发抓取放行，
// AI 训练与数据采集继续拒绝。名单调整时这两组期望值必须同步。
for (const agent of ['oai-searchbot', 'chatgpt-user', 'claude-searchbot', 'claude-user',
  'perplexitybot', 'perplexity-user', 'meta-externalfetcher']) {
  const group = robotsGroup(agent);
  report(!!group && robotsAllowsAll(group) && !robotsBlocksAll(group),
    `robots.txt must allow the ${agent} AI search crawler`);
}
for (const agent of ['gptbot', 'claudebot', 'ccbot', 'bytespider', 'google-extended',
  'applebot-extended', 'meta-externalagent']) {
  const group = robotsGroup(agent);
  report(!!group && robotsBlocksAll(group),
    `robots.txt must keep the ${agent} AI training crawler blocked`);
}

// Cloudflare Pages 的 `_headers`（scripts/cloudflare-headers.js 生成）。
// 这里守几条容易悄悄改坏的约定：
//   - 安全头必须挂在 `/*` 上；
//   - CSP 必须放行主题运行时按需加载的第三方来源（漏一个，线上就是排版/图表失效）；
//   - `/*` 上不允许出现 Cache-Control —— Cloudflare 会把命中多条规则的同一个头
//     用逗号拼起来，`/*` 再写一条就会和资源规则拼出语义不明的值；
//   - 规则总数不能超过 Cloudflare 的 100 条上限。
const headersText = readFileSync(resolve(output, '_headers'), 'utf8');
const headerBlocks = headersText.split(/\n\s*\n/).map(block => {
  const lines = block.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'));
  const [pattern, ...rest] = lines;
  const headers = {};
  for (const line of rest) {
    const separator = line.indexOf(':');
    if (separator > 0) headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  return { pattern: (pattern || '').trim(), headers };
}).filter(block => block.pattern);
const catchAll = headerBlocks.find(block => block.pattern === '/*');
report(Boolean(catchAll), '_headers is missing the catch-all /* block');
if (catchAll) {
  for (const name of ['strict-transport-security', 'content-security-policy', 'x-content-type-options',
    'x-frame-options', 'referrer-policy', 'permissions-policy']) {
    report(Boolean(catchAll.headers[name]), `_headers: /* is missing ${name}`);
  }
  report(!catchAll.headers['cache-control'],
    '_headers: /* must not set Cache-Control (Cloudflare comma-joins overlapping rules)');
  const csp = catchAll.headers['content-security-policy'] || '';
  for (const token of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'",
    'https://gcore.jsdelivr.net', 'https://unpkg.com', 'https://cdnjs.cloudflare.com',
    'connect-src \'self\' https://api.github.com']) {
    report(csp.includes(token), `_headers: CSP is missing ${token}`);
  }
  // MathJax 的字形从 cdnjs 拉，font-src 漏了就是一堆豆腐块
  report(/font-src[^;]*cdnjs\.cloudflare\.com/.test(csp), '_headers: CSP font-src does not allow MathJax fonts');
}
for (const pattern of ['/*.css', '/*.js', '/*.jpg', '/*.webp', '/*.avif']) {
  report(headerBlocks.some(block => block.pattern === pattern && block.headers['cache-control']),
    `_headers: missing Cache-Control for ${pattern}`);
}
report(headerBlocks.length <= 100, `_headers has ${headerBlocks.length} rules, Cloudflare allows 100`);

// 第二条通道（腾讯云 ECS + Nginx）不认 `_headers` 文件，安全头是在
// deploy/server-setup.sh 的 Nginx 模板里另写一遍的。两处的 CSP 字符串必须逐字符相同，
// 否则同一个站点在两条通道上的策略会悄悄分叉。这里直接比对。
const nginxConfig = readFileSync('deploy/server-setup.sh', 'utf8');
const nginxCsp = /add_header Content-Security-Policy "([^"]+)"/.exec(nginxConfig);
report(Boolean(nginxCsp), 'deploy/server-setup.sh is missing the Nginx Content-Security-Policy header');
if (nginxCsp && catchAll) {
  report(nginxCsp[1] === catchAll.headers['content-security-policy'],
    'CSP differs between scripts/cloudflare-headers.js and deploy/server-setup.sh');
}
for (const header of ['X-Frame-Options', 'Permissions-Policy', 'Cross-Origin-Resource-Policy']) {
  report(new RegExp(`add_header ${header} "`).test(nginxConfig),
    `deploy/server-setup.sh is missing the Nginx ${header} header`);
}

// 搜索引擎收录：站内只做“配置了就必须生效”的检查，没填的键不产生任何输出。
// 百度搜索资源平台的那条验证等域名备案后再加进 seoMeta。
const seo = config.seo || {};
const seoMeta = {
  google: 'google-site-verification',
  bing: 'msvalidate.01'
};
const homepage = load(readFileSync(resolve(output, 'index.html'), 'utf8'));
for (const [key, name] of Object.entries(seoMeta)) {
  const token = ((seo.verification || {})[key] || '').trim();
  if (!token) continue;
  report(homepage(`meta[name="${name}"]`).attr('content') === token, `Homepage is missing the ${name} verification meta`);
}
const indexnowKey = (seo.indexnow_key || '').trim();
if (indexnowKey) {
  const keyFile = resolve(output, `${indexnowKey}.txt`);
  report(indexnowKey.length >= 8, 'IndexNow key must be at least 8 characters');
  report(existsSync(keyFile), `Missing IndexNow key file: ${indexnowKey}.txt`);
  if (existsSync(keyFile)) {
    report(readFileSync(keyFile, 'utf8').trim() === indexnowKey, 'IndexNow key file content does not match seo.indexnow_key');
  }
}

// 备案信息：填了就必须出现在页脚，而且 ICP 备案号必须链到工信部备案系统
// （大陆访问上线前的硬性要求）。留空时这里什么都不检查、页面也不输出。
const beian = config.beian || {};
const icp = (beian.icp || '').trim();
if (icp) {
  report(homepage.html().includes(icp), `Homepage is missing the ICP filing number: ${icp}`);
  report(homepage('a[href^="https://beian.miit.gov.cn"]').length > 0,
    'The ICP filing number must link to https://beian.miit.gov.cn');
}
const police = (beian.police || '').trim();
if (police) {
  report(homepage.html().includes(police), `Homepage is missing the police filing number: ${police}`);
}

// README 与文档之间用相对路径互相引用。这些链接不参与站点构建，所以断了也没人会发现；
// 2026-10-17 就出现过 docs/ 整个目录从工作区消失、而所有检查照常通过的情况。
// 这里把「仓库内的文档链接」也纳入自检。
for (const doc of ['README.md', 'docs/domain-deployment.md', 'docs/mainland-hosting.md']) {
  if (!existsSync(doc)) {
    errors.push(`Missing documentation file: ${doc}`);
    continue;
  }
  const text = readFileSync(doc, 'utf8');
  for (const match of text.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+\.(?:md|yml|sh|js|mjs|conf|txt))/g)) {
    const target = resolve(dirname(doc), decodeURIComponent(match[1]));
    report(existsSync(target), `${doc}: link points at a missing file: ${match[1]}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${pages.length} HTML pages, local links/assets, search, Atom feed, sitemap, metadata and license.`);
}

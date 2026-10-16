import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
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
  'categories/index.html', 'tags/index.html', 'topic/index.html', 'notebooks/index.html', 'notebooks/dba/index.html',
  '404.html', 'atom.xml', 'search.json', 'sitemap.xml', 'robots.txt']) {
  report(existsSync(resolve(output, path)), `Missing required page: ${path}`);
}

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
  if (path === 'index.html') {
    report($('.wiki-hero h1').text() === '记录问题，也记录风景。', 'Native homepage hero is missing');
    report($('.wiki-hero a[href="#start"]').length > 0 && $('#start').length === 1, 'Homepage reading anchor is missing');
  }
  report($('main, [role="main"]').length === 1, `${path}: missing main landmark`);
  report(($('meta[name="viewport"]').attr('content') || '').includes('width=device-width'), `${path}: missing responsive viewport`);
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
const robotsText = readFileSync(resolve(output, 'robots.txt'), 'utf8');
report(robotsText.includes(new URL('sitemap.xml', site).href), 'robots.txt has wrong sitemap URL');

// robots.txt 的抓取策略：默认封禁、搜索引擎显式放行。改策略时这里的期望值要一起改。
// 只做「组是否被整体封禁」的粗粒度判断，够用来拦住把策略改回全站放行的错误。
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

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${pages.length} HTML pages, local links/assets, search, Atom feed, sitemap, metadata and license.`);
}

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { load } from 'cheerio';
import yaml from 'js-yaml';
import { unescapeHTML } from 'hexo-util';

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
  'categories/index.html', 'tags/index.html', '404.html', 'atom.xml', 'search.json', 'sitemap.xml', 'robots.txt']) {
  report(existsSync(resolve(output, path)), `Missing required page: ${path}`);
}

const pages = files(output).filter(path => path.endsWith('.html'));
const articles = [];
for (const file of pages) {
  const path = relative(output, file).split(sep).join('/');
  const url = new URL(path, site);
  const $ = load(readFileSync(file, 'utf8'));
  report(!unescapeHTML(readFileSync(file, 'utf8')).includes('https://guangl.github.io/blog'), `${path}: stale GitHub Pages URL`);
  report(Boolean($('title').text().trim()), `${path}: missing title`);
  report(Boolean($('meta[name="description"]').attr('content')), `${path}: missing description`);
  if (path === 'index.html') {
    report($('.wiki-hero h1').text() === '记录问题，也记录风景。', 'Native homepage hero is missing');
    report($('.wiki-hero a[href="#start"]').length > 0 && $('#start').length === 1, 'Homepage reading anchor is missing');
  }
  report($('main, [role="main"]').length === 1, `${path}: missing main landmark`);
  report(($('meta[name="viewport"]').attr('content') || '').includes('width=device-width'), `${path}: missing responsive viewport`);
  const canonical = $('link[rel="canonical"]');
  if (path !== '404.html') {
    report(canonical.length === 1, `${path}: expected one canonical URL`);
    report(canonical.attr('href') === new URL(path.replace(/index\.html$/, ''), site).href,
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
report(readFileSync(resolve(output, 'robots.txt'), 'utf8').includes(new URL('sitemap.xml', site).href), 'robots.txt has wrong sitemap URL');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${pages.length} HTML pages, local links/assets, search, Atom feed, sitemap, metadata and license.`);
}

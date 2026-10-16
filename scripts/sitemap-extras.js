/* global hexo */
/**
 * 站点地图补全（构建期）
 *
 * `templates/sitemap.xml` 是自定义的 nunjucks 模板，它只能拿到
 * hexo-generator-sitemap 传进去的 locals（posts / tags / categories / config），
 * 所以有两块内容它天生写不出来：
 *
 * 1. **文章照片**。Google 的图片 sitemap 扩展要每条 `<url>` 下带
 *    `<image:image><image:loc>`，照片站最该吃这条流量（图片搜索）。图片清单要从
 *    文章正文里现取，模板拿不到 helper，硬写又会在正文换图后过期。
 * 2. **列表页与归档页**。`/posts/`（hexo-generator-index）和
 *    `/archives/`、`/archives/2026/09/`（hexo-generator-archive）都不是
 *    post 也不是 page，模板里的 `posts` 循环扫不到它们。
 *
 * 做法是在 `after_generate` 里改写 `sitemap.xml` 这条路由：此时所有 generator
 * 都跑完了，可以从 `hexo.route.list()` 里确认页面/图片真的存在，再决定收不收——
 * 不会出现「模板里写了、产物里没有」的 404 条目。`tools/check-site.mjs`
 * 会逐条校验 sitemap 里的 URL（含图片）都能在产物里找到。
 *
 * 收录口径（2026-10-17 决定）：
 *   - 收：文章、首页、`/posts/`、`/archives/` 与年月归档、分类页、标签页、独立页面。
 *   - 不收：分页（`/posts/page/2/`）。同一批文章在分页里重复出现，而且
 *     `page/1` 与 `/posts/` 是同一份内容，收进来只会浪费抓取配额。
 *   - 标签/分类页虽然内容薄，但它们是站内唯一的主题入口，保留 priority 0.2。
 */

"use strict";

const { encodeURL } = require("hexo-util");

const { contentImagePaths, coverPath, routeExists } = require("./photo-index");

const IMAGE_NAMESPACE = "http://www.google.com/schemas/sitemap-image/1.1";

const LOC_PATTERN = /<loc>([\s\S]*?)<\/loc>/g;

function readRoute(path) {
  return new Promise((resolve, reject) => {
    const stream = hexo.route.get(path);
    if (!stream) {
      resolve("");
      return;
    }
    const chunks = [];
    stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

function decodeEntities(value) {
  return String(value)
    .replace(/&#x2F;|&#47;/gi, "/")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 列表页与归档页：直接从路由里捞，产物有才收。
 * 这样 hexo-generator-archive 的目录结构变了也不会漏，不用在这里维护路径规则。
 * URL 一律走 encodeURL，与模板里的 `| uriencode` 保持一致（否则中文路径对不上）。
 */
function listingUrls(hexo, site) {
  const urls = [];
  const push = (url) => {
    if (!urls.includes(url)) urls.push(url);
  };
  if (routeExists(hexo, "posts/")) push(encodeURL(new URL("posts/", site).href));
  for (const route of hexo.route.list()) {
    if (/^archives\/(?:\d{4}\/)?(?:\d{2}\/)?index\.html$/.test(route)) {
      push(encodeURL(new URL(route.replace(/index\.html$/, ""), site).href));
    }
  }
  return urls.sort();
}

/**
 * 一篇文章的图片（绝对 URL）：封面在前，正文图按出现顺序，去重、只留产物里真有的。
 * 解析正文 src、判定本站/外链的逻辑在 scripts/photo-index.js 里，与相册页共用一份。
 */
function postImages(hexo, post, site) {
  const origin = new URL(site).origin;
  const found = [];
  const push = (pathname) => {
    if (!pathname || !routeExists(hexo, pathname)) return;
    const href = origin + encodeURL(pathname);
    if (!found.includes(href)) found.push(href);
  };
  push(coverPath(post));
  for (const pathname of contentImagePaths(post)) push(pathname);
  return found;
}

function renderImage(image, title) {
  return [
    "    <image:image>",
    `      <image:loc>${escapeXml(image)}</image:loc>`,
    title ? `      <image:title>${escapeXml(title)}</image:title>` : "",
    "    </image:image>"
  ].filter(Boolean).join("\n");
}

/**
 * 把 `<image:image>` 插进对应的 `<url>` 块。
 * 模板已经按 post/permalink 输出过 `<url>`，这里只做插入，不重排。
 */
function attachImages(xml, imagesByUrl) {
  return xml.replace(/[ \t]*<url>[\s\S]*?<\/url>/g, (block) => {
    const loc = /<loc>([\s\S]*?)<\/loc>/.exec(block);
    if (!loc) return block;
    const images = imagesByUrl.get(decodeEntities(loc[1]).trim());
    if (!images || images.length === 0) return block;
    const title = images.title;
    const rendered = images
      .map(image => renderImage(image, title))
      .join("\n");
    return `${block}\n${rendered}`;
  });
}

function insertBeforeClose(xml, chunk) {
  const index = xml.lastIndexOf("</urlset>");
  if (index < 0) return xml;
  return xml.slice(0, index) + chunk + "\n" + xml.slice(index);
}

function extraEntry(url) {
  return [
    "  <url>",
    `    <loc>${escapeXml(url)}</loc>`,
    "    <changefreq>weekly</changefreq>",
    "    <priority>0.4</priority>",
    "  </url>"
  ].join("\n");
}

hexo.extend.filter.register("after_generate", async () => {
  if (!hexo.route.list().includes("sitemap.xml")) return;
  const xml = await readRoute("sitemap.xml");
  if (!xml.includes("<urlset")) return;

  const site = hexo.config.url;
  const existing = new Set();
  let match;
  const locPattern = new RegExp(LOC_PATTERN.source, "g");
  while ((match = locPattern.exec(xml)) !== null) existing.add(decodeEntities(match[1]).trim());

  // 文章图片：按 permalink 归组，等下插到同一条 <url> 里
  const imagesByUrl = new Map();
  for (const post of hexo.locals.get("posts").toArray()) {
    const images = postImages(hexo, post, site);
    if (images.length === 0) continue;
    imagesByUrl.set(encodeURL(new URL(post.permalink).href), images);
  }

  let next = xml;
  if (imagesByUrl.size > 0) {
    if (!next.includes("xmlns:image=")) {
      next = next.replace("<urlset ", `<urlset xmlns:image="${IMAGE_NAMESPACE}" `);
    }
    next = attachImages(next, imagesByUrl);
  }

  // 列表页与归档页：模板扫不到，这里补在末尾，并跳过模板已经输出过的地址
  const extras = listingUrls(hexo, site).filter(url => !existing.has(url));
  if (extras.length > 0) next = insertBeforeClose(next, extras.map(extraEntry).join("\n"));

  hexo.route.set("sitemap.xml", next);
  hexo.log.info(`站点地图：${imagesByUrl.size} 篇文章带图，补 ${extras.length} 条列表/归档页`);
});

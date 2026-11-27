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
 * 2. **文章列表入口**。`/posts/`（hexo-generator-index）既不是 post 也不是 page，
 *    模板里的 `posts` 循环扫不到它。
 *
 * 做法是在 `after_generate` 里改写 `sitemap.xml` 这条路由：此时所有 generator
 * 都跑完了，可以从 `hexo.route.list()` 里确认页面/图片真的存在，再决定收不收——
 * 不会出现「模板里写了、产物里没有」的 404 条目。`tools/check-site.mjs`
 * 会逐条校验 sitemap 里的 URL（含图片）都能在产物里找到。
 *
 * 不提交 Stellar 标记为 noindex 的归档、分类和标签，也不提交文章列表的分页。
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

  const postsUrl = encodeURL(new URL("posts/", site).href);
  const addPosts = routeExists(hexo, "posts/") && !existing.has(postsUrl);
  if (addPosts) next = insertBeforeClose(next, extraEntry(postsUrl));

  hexo.route.set("sitemap.xml", next);
  hexo.log.info(`站点地图：${imagesByUrl.size} 篇文章带图${addPosts ? "，补上文章列表入口" : ""}`);
});

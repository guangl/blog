/**
 * 照片索引（构建期共享工具）
 *
 * 这个文件不注册任何 Hexo 钩子，只导出几个函数，供 `gallery.js`、`photo-meta.js`
 * 与 `sitemap-extras.js` require——三处都要回答同一个问题：「这篇文章有哪些照片」。
 *
 * 为什么这些函数要显式接收 `hexo`：Hexo 加载 `scripts/` 下的文件时，是把每个文件
 * 包成 `(function(exports, require, module, __filename, __dirname, hexo){...})` 再执行的，
 * `hexo` 是**每个插件文件自己的参数**、不是全局变量。所以被 require 进来的这个模块
 * 里没有 `hexo`，需要的调用方只能自己传（想当然地用全局会得到 `hexo is not defined`）。
 *
 * 另外两个约定，写在这里免得各写一套：
 *   1. 路径一律取「站点根相对、且已解码」的形式（`/2026/09/13/slug/preview.jpg`）。
 *      中文路径在 URL 里是百分号编码的，而 Hexo 的路由表与图片管线的 manifest 用的是
 *      裸 UTF-8，解码后再比对才不会漏。
 *   2. 正文图只认 `post.content` 里的 `<img src>`，按出现顺序去重；`cover` 单独返回，
 *      因为「相册要不要用封面」各处取舍不同。站点之外的图片（图床、外链）一律丢掉。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const IMG_SRC_PATTERN = /<img\b[^>]*\bsrc="([^"]+)"/gi;
const SOURCE_IMAGE = /\.(?:jpe?g|png)$/i;

function decodeEntities(value) {
  return String(value)
    .replace(/&#x2F;|&#47;/gi, "/")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

/** 把正文里的 src 变成站点根相对路径；外链与 data: 返回 null。 */
function toSitePath(value, base) {
  if (typeof value !== "string" || value.length === 0) return null;
  let url;
  try {
    url = new URL(decodeEntities(value), base);
  } catch {
    return null;
  }
  if (url.origin !== new URL(base).origin) return null;
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return url.pathname;
  }
}

/** 正文里按出现顺序排列的图片路径（去重）。 */
function contentImagePaths(post) {
  const found = [];
  const pattern = new RegExp(IMG_SRC_PATTERN.source, "gi");
  let match;
  while ((match = pattern.exec(post.content || "")) !== null) {
    const src = toSitePath(match[1], post.permalink);
    if (src && !found.includes(src)) found.push(src);
  }
  return found;
}

/** front-matter 的 cover，没有就返回 null。 */
function coverPath(post) {
  return toSitePath(post.cover, post.permalink);
}

/**
 * 路由查询：`/2026/09/13/slug/preview.jpg` 这种站点根相对路径在产物里存不存在。
 * 路由表里目录是 `xxx/index.html`，中文路径是裸 UTF-8，所以两种写法都试。
 */
function routeExists(hexo, pathname) {
  const routes = new Set(hexo.route.list());
  const clean = String(pathname).replace(/^\/+/, "");
  if (clean === "") return routes.has("index.html");
  const candidates = [clean];
  try {
    candidates.push(decodeURIComponent(clean));
  } catch {
    // 非法转义序列：只用原样形式
  }
  return candidates.some(candidate =>
    routes.has(candidate) || routes.has(candidate.replace(/\/$/, "") + "/index.html"));
}

/**
 * 文章资源目录里的原始图片文件（绝对路径）。
 * 只认 `source/_posts/<slug>/` 下的 jpg/png——产物里的变体不在 source 里，
 * 所以读 EXIF 时不会读到被 sharp 重新编码过的副本。
 */
function sourceImageFiles(hexo, post) {
  if (!post.slug) return [];
  const dir = path.join(hexo.source_dir, "_posts", post.slug);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort()
    .filter(name => SOURCE_IMAGE.test(name))
    .map(name => path.join(dir, name));
}

module.exports = { contentImagePaths, coverPath, routeExists, sourceImageFiles, toSitePath };

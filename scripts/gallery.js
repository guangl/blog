/* global hexo */
/**
 * 相册页（构建期）
 *
 * `/gallery/` 的照片不该手写在 Markdown 里——每发一篇文章都要回来补一次，迟早忘记。
 * 这里在构建期扫全部文章，把「正文里显示出来的照片」按发布时间从新到旧拼成一个网格，
 * 替换掉 `source/gallery/index.md` 里的 `<!-- gallery -->` 占位符。
 *
 * 取图规则：
 *   - 优先正文里的图（那是作者真正想展示的那一张，通常已经是 1600px 长边的预览图）；
 *   - 正文没有图就退回 front-matter 的 `cover`，一篇文章在相册里至少出现一次；
 *   - 同一篇文章的多张图全部收进来，`alt` 用「文章标题（第 N 张）」，标题链到原文。
 *
 * 输出刻意复用主题 gallery 标签的结构（`grid-box` / `grid-cell` / `data-fancybox`）：
 * 网格样式和 Fancybox 灯箱都直接吃主题的 CSS，只补一条自己的标题样式。
 *
 * 两处与主题原版不同，都是实测出来的：
 *   - 主题把标题放在 `.image-meta` 覆盖层里，那是 hover 才显形、而且 `pointer-events: none`
 *     的装饰层，鼠标点不到、触屏更没有 hover。所以另外在图片下方放一行可点的标题
 *     （`.gallery-caption`），照片本身仍然点开灯箱——「点照片放大、点标题进文章」。
 *   - Fancybox 的 CSS 来自 gcore.jsdelivr.net，CSP 的 `style-src` 必须放行这个域名，
 *     否则灯箱的样式表被拦掉、点击没有任何反应（`bun run browser:a11y` 会报 CSP 违规）。
 *
 * 图片先以 `data-src` 输出，交给 `scripts/image-pipeline.js` 换成 `<picture>` + 原生懒加载
 * ——本插件注册在优先级 5，管线是 8，所以一定会被处理到。
 */

"use strict";

const { contentImagePaths, coverPath, routeExists } = require("./photo-index");

const PLACEHOLDER = "<!-- gallery -->";
const GALLERY_CLASS = "gallery-photo";
const CAPTION_CLASS = "gallery-caption";
const FANCYBOX_GROUP = "gallery-site";
const SIZE = "xl"; // 2 列。相册以看图为主，主题默认的 m(150px) 太小
// 长宽比保持原图：square 会把横构图裁成方的，构图都变了，学摄影的站不能这么干。
const ASPECT_RATIO = "original";

const CAPTION_CSS = `<style>
.${CAPTION_CLASS}{padding:.45em .15em 0;font-size:13px;line-height:1.45}
.${CAPTION_CLASS} a{color:inherit;text-decoration:none;opacity:.75}
.${CAPTION_CLASS} a:hover{opacity:1;text-decoration:underline}
</style>`;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

/** 一篇文章在相册里的照片；正文优先，没有正文图就用封面。 */
function photosOf(hexo, post) {
  const body = contentImagePaths(post).filter(pathname => routeExists(hexo, pathname));
  if (body.length > 0) return body;
  const cover = coverPath(post);
  return cover && routeExists(hexo, cover) ? [cover] : [];
}

function collectPhotos(hexo) {
  const items = [];
  const posts = hexo.locals.get("posts").toArray()
    .slice()
    .sort((a, b) => b.date - a.date);
  for (const post of posts) {
    const photos = photosOf(hexo, post);
    const title = String(post.title || "").trim() || "未命名";
    photos.forEach((src, index) => {
      items.push({
        src,
        href: post.permalink,
        alt: photos.length > 1 ? `${title}（第 ${index + 1} 张）` : title
      });
    });
  }
  return items;
}

function renderGallery(items) {
  const cells = items.map(item => {
    const img = `<img class="lazy ${GALLERY_CLASS}" data-fancybox="${FANCYBOX_GROUP}"`
      + ` data-src="${escapeAttr(item.src)}" alt="${escapeAttr(item.alt)}"/>`;
    const caption = `<div class="${CAPTION_CLASS}">`
      + `<a href="${escapeAttr(item.href)}">${escapeHtml(item.alt)}</a></div>`;
    return `<div class="grid-cell lazy-box">${img}<div class="lazy-icon"></div>${caption}</div>`;
  }).join("");
  return `<div class="tag-plugin gallery grid-box" size="${SIZE}" aspect_ratio="${ASPECT_RATIO}">${cells}</div>`;
}

hexo.extend.filter.register("after_render:html", html => {
  if (typeof html !== "string" || !html.includes(PLACEHOLDER)) return html;
  const items = collectPhotos(hexo);
  if (items.length === 0) {
    hexo.log.warn("相册：一篇文章都没有可用的照片，占位符原样留着");
    return html;
  }
  hexo.log.info(`相册：收录 ${items.length} 张照片`);
  const withGallery = html.replace(PLACEHOLDER, renderGallery(items));
  if (withGallery.includes(`.${CAPTION_CLASS}{`)) return withGallery;
  return withGallery.replace("</head>", `${CAPTION_CSS}</head>`);
}, 5);

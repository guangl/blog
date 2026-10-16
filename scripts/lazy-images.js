/* global hexo */
/**
 * 原生图片懒加载（构建期）
 *
 * 主题的懒加载完全依赖它自己的 JS：`src` 放 1×1 占位图、真地址在 `data-src`，
 * 由 IntersectionObserver 在进入视口时才替换。这条链路有两个问题：
 *   - 浏览器无法在 JS 执行前得知图片可以延后，CP 感知更晚；
 *   - 一旦 JS 失败或被拦，占位图会永久留在页面上。
 *
 * 这里给「已经有真实 src」的图片补上原生 `loading="lazy"` 与 `decoding="async"`，
 * 让浏览器自身也参与调度，与主题的 JS 方案叠加而不冲突。
 *
 * 刻意跳过 `src` 仍是 data: 占位的图片：那种图必须靠主题 JS 换上真地址，
 * 若给它们加原生 lazy，一旦 JS 未执行就会变成永久占位图（属于回归）。
 *
 * 也不处理 Hero 首屏图：它常是 LCP 元素，延后加载只会推迟最大内容绘制。
 */

"use strict";

function isPlaceholder(source) {
  return /^data:/i.test(source || "");
}

function addLazyAttributes(html) {
  return html.replace(/<img\b[^>]*>/gi, tag => {
    if (!/\bclass="[^"]*\blazy\b/i.test(tag)) return tag;
    const src = (tag.match(/\bsrc="([^"]*)"/i) || [])[1];
    if (src === undefined || isPlaceholder(src)) return tag;

    let out = tag;
    if (!/\bloading=/i.test(out)) out = out.replace(/<img\b/i, '<img loading="lazy"');
    if (!/\bdecoding=/i.test(out)) out = out.replace(/<img\b/i, '<img decoding="async"');
    return out;
  });
}

hexo.extend.filter.register("after_render:html", html => {
  if (typeof html !== "string" || !html.includes("</head>")) return html;
  if (!html.includes("<img")) return html;
  return addLazyAttributes(html);
}, 7);

/* global hexo */
/**
 * 原生图片懒加载（构建期）
 *
 * 主题的懒加载完全依赖它自己的 JS：`src` 放 1×1 占位图、真地址在 `data-src`，
 * 由 IntersectionObserver 在进入视口时才替换。这条链路有两个问题：
 *   - 浏览器无法在 JS 执行前得知图片可以延后，CP 感知更晚；
 *   - 一旦 JS 失败或被拦，占位图会永久留在页面上。
 *
 * 这里给**所有已经有真实 src、又没被别处定过 loading 的图**补上原生
 * `loading="lazy"` 与 `decoding="async"`，让浏览器自己也参与调度：
 *   - 主题 `.lazy` 图（真地址还在 `data-src`、`src` 是占位）跳过：那种图必须等主题
 *     JS 换 src，硬加原生 lazy 一旦 JS 没跑就是永久占位图（属于回归）；
 *   - 图片管线改写过的 `<picture>` 自带 `loading="lazy"`，这里直接放行；
 *   - 主题标了 `no-lazy` 的头像也一并补上（2026-10-17 起）。
 *
 * 2026-10-17 之前这里刻意跳过 Hero 首屏图（它常是 LCP）。首页 Hero 的背景大图已经
 * 去掉了（见 source/_data/wiki/home.yml），站点上不再有「值得抢首屏」的图片，
 * 所以这个例外一起删掉，规则收敛成「全部懒加载」。
 */

"use strict";

function isPlaceholder(source) {
  return /^data:/i.test(source || "");
}

function addLazyAttributes(html) {
  return html.replace(/<img\b[^>]*>/gi, tag => {
    // 已经有 loading 的说明别处（图片管线）明确表态过，不再覆盖
    if (/\bloading=/i.test(tag)) return tag;
    const src = (tag.match(/\bsrc="([^"]*)"/i) || [])[1];
    if (src === undefined || src === "" || isPlaceholder(src)) return tag;

    let out = tag;
    if (!/\bdecoding=/i.test(out)) out = out.replace(/<img\b/i, '<img decoding="async"');
    return out.replace(/<img\b/i, '<img loading="lazy"');
  });
}

hexo.extend.filter.register("after_render:html", html => {
  if (typeof html !== "string" || !html.includes("</head>")) return html;
  if (!html.includes("<img")) return html;
  return addLazyAttributes(html);
}, 7);

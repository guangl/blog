/* global hexo */
/**
 * 无障碍修正（构建期）
 *
 * 三件事，都在产物 HTML 上做，不改主题文件：
 *
 * 1. **每页一个 h1**。主题在首页会同时输出两个 h1：
 *      <h1 class="cover-title">  Hero 大标题
 *      <h1 class="text title">   页面标题「欢迎来访」
 *    一个页面多个 h1 会让屏幕阅读器按标题导航时出现两个「一级」入口。
 *    这里的规则是「保留第一个，其余降级为 h2」：首页保留 Hero 大标题，
 *    关于 / 订阅 / 组件示例这些只有页面标题的页面不受影响。
 *    降级不会改变外观——主题的标题样式挂在 `.title` 类上（
 *    `.article.banner .content .title { font-size: calc(...) }`），与标签名无关。
 *
 * 2. **列表页补一个 h1**。`/posts/`、`/archives/`、`/categories/*`、`/tags/*`
 *    这些列表页一个 h1 都没有（主题直接铺卡片，页面级标题只有 <title>）。
 *    这里按 canonical 路径推一个语义正确的 h1 插到 <main> 开头，并用
 *    clip 技巧做视觉隐藏：屏幕阅读器能按标题跳转，画面不变。
 *    不用 display:none——那会被无障碍树忽略，等于没加。
 *
 * 3. **图片补 alt**。主题给头像和 Hero 背景都写了 alt=""，但文章卡片封面和
 *    文章页的封面没有 alt 属性（完全缺失，与「明确表示装饰性」的 alt="" 不同）。
 *    规则：卡片封面用同一张卡片里的文章标题；背景类（class 含 bg）与拿不到
 *    标题的，一律 alt=""（装饰性）。
 *
 * `tools/check-site.mjs` 会检查这三条不被改回去（每页恰好一个 h1、图片都有 alt）。
 */

"use strict";

const VISUALLY_HIDDEN = "a11y-visually-hidden";

const VISUALLY_HIDDEN_CSS = `<style>
.${VISUALLY_HIDDEN}{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
</style>`;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripTags(value) {
  return String(value).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * 保留第一个 h1，其余（连同其结束标签）降级成 h2。
 * 用非贪婪匹配到最近的 </h1>，标题内部只有 span 之类的行内标签，不会嵌套 h1。
 */
function demoteExtraHeadings(html) {
  let seen = 0;
  return html.replace(/<h1(\b[^>]*)>([\s\S]*?)<\/h1>/gi, (whole, attrs, inner) => {
    seen += 1;
    return seen === 1 ? whole : `<h2${attrs}>${inner}</h2>`;
  });
}

/** 从 canonical 里取输出路径，例如 /tags/武汉/ → tags/武汉 */
function outputPath(html, data) {
  if (data && typeof data.path === "string" && data.path.length > 0) return data.path;
  const canonical = /<link rel="canonical" href="([^"]+)"/i.exec(html);
  if (!canonical) return "";
  try {
    return decodeURIComponent(new URL(canonical[1]).pathname).replace(/^\/+/, "");
  } catch {
    return "";
  }
}

/** 列表页的语义标题：按主题的路由约定推，推不出来就不插。 */
function listingHeading(path) {
  if (!path) return "";
  const clean = path.replace(/index\.html$/, "").replace(/\/+$/, "");
  if (clean === "posts") return "所有文章";
  if (clean === "archives") return "归档";
  if (clean === "categories") return "分类";
  if (clean === "tags") return "标签";
  if (clean === "settings") return "设置";
  const month = /^archives\/(\d{4})\/(\d{2})$/.exec(clean);
  if (month) return `${month[1]} 年 ${Number(month[2])} 月归档`;
  const year = /^archives\/(\d{4})$/.exec(clean);
  if (year) return `${year[1]} 年归档`;
  if (clean.startsWith("categories/")) return `分类：${clean.slice("categories/".length)}`;
  if (clean.startsWith("tags/")) return `标签：${clean.slice("tags/".length)}`;
  return "";
}

function ensurePageHeading(html, path) {
  if (/<h1[\s>]/i.test(html)) return html;
  const heading = listingHeading(path);
  if (!heading) return html;
  const main = /<main\b[^>]*>/i.exec(html);
  if (!main) return html;
  const injected = `<h1 class="${VISUALLY_HIDDEN}">${escapeHtml(heading)}</h1>`;
  const withHeading = html.replace(main[0], `${main[0]}${injected}`);
  return withHeading.replace("</head>", `${VISUALLY_HIDDEN_CSS}</head>`);
}

/**
 * 给缺 alt 的图片补 alt。卡片封面用同卡片的文章标题，其余按装饰性处理。
 * 文章标题在卡片里位于封面之后，所以「封面后面最近的一个 post-title」就是它的标题。
 */
function ensureImageAlt(html) {
  const titles = [];
  const pattern = /<h2 class="post-title">([\s\S]*?)<\/h2>/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    titles.push({ index: match.index, text: stripTags(match[1]) });
  }
  return html.replace(/<img\b[^>]*>/gi, (tag, offset) => {
    if (/\balt\s*=/i.test(tag)) return tag;
    const className = (/\bclass="([^"]*)"/i.exec(tag) || [])[1] || "";
    const isBackground = /(^|\s)bg(\s|$)/.test(className);
    const isCardCover = /post-cover[^>]*>\s*$/.test(html.slice(Math.max(0, offset - 240), offset));
    let alt = "";
    if (!isBackground && isCardCover) {
      const next = titles.find(item => item.index > offset);
      if (next) alt = next.text;
    }
    return tag.replace(/<img\b/i, `<img alt="${escapeHtml(alt)}"`);
  });
}

hexo.extend.filter.register("after_render:html", (html, data) => {
  if (typeof html !== "string" || !html.includes("</head>")) return html;
  let out = demoteExtraHeadings(html);
  out = ensureImageAlt(out);
  out = ensurePageHeading(out, outputPath(html, data));
  return out;
}, 6);

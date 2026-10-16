/* global hexo */
/**
 * SEO 修正插件（构建期）
 *
 * 修两处主题行为，都是实测产物发现的：
 *
 * 1. 结构化数据的图片是相对路径。
 *    `scripts/helpers/json_ld.js` 与 `lib/models/shared.js` 把 `authorImage`
 *    绝对化了，但文章 `image` 直接使用 `postImages()` 的返回值，于是输出成
 *    `/2026/.../cover.jpg`。schema.org 要求绝对 URL，Google 富媒体测试会报错。
 *    这里用 canonical 的 origin 把它们补成绝对地址。
 *
 * 2. 社交卡片的图。主题的兜底顺序是 `pageConfig.cover || 正文首图 || config.avatar`，
 *    所以「没有封面的页面」拿到的都是站点头像——首页、关于、订阅、相册这些页面
 *    在社交平台和 IM 里就是一张 280×280 的小头像，不是 1200×630 的卡片。
 *    这里做两件事：
 *      - og:image / twitter:image 只要落在头像上，就换成 fallbacks.cover
 *        （1200×630）；文章自己的封面、正文首图不受影响；
 *      - twitter:card 统一成 summary_large_image。主题只在「文章 + 有封面」时
 *        才用大卡片，修完图片之后所有页面都有合格的大图，小卡片反而不合适。
 *
 * 只改 HTML 输出，不改动 Markdown 与主题文件。
 */

"use strict";

const ABSOLUTE_OR_DATA = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function originOf(html) {
  const match = html.match(/<link rel="canonical" href="([^"]+)"/);
  if (match) {
    try {
      return new URL(match[1]).origin;
    } catch {
      // 落到下面的配置兜底
    }
  }
  // 404 页故意不带 canonical（见 tools/check-site.mjs），但它同样有 og / twitter 标签，
  // 这些标签里的相对路径也得补齐，所以退回到站点自身的 url。
  try {
    return new URL(hexo.config.url).origin;
  } catch {
    return null;
  }
}

function toAbsolute(value, origin) {
  if (typeof value !== "string" || value.length === 0) return value;
  if (ABSOLUTE_OR_DATA.test(value)) return value;
  return value.startsWith("/") ? origin + value : `${origin}/${value}`;
}

// 收集本页结构化数据里声明的封面（含 photos 与正文首图）
function declaredImages(html, origin) {
  const out = [];
  const blocks = html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g);
  for (const block of blocks) {
    let data;
    try {
      data = JSON.parse(block[1]);
    } catch {
      continue;
    }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (!item || item["@type"] !== "BlogPosting") continue;
      const images = Array.isArray(item.image) ? item.image : item.image ? [item.image] : [];
      for (const image of images) {
        out.push(toAbsolute(typeof image === "string" ? image : image && image.url, origin));
      }
    }
  }
  return out.filter(Boolean);
}

function absolutizeJsonLd(html, origin) {
  return html.replace(
    /(<script type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/g,
    (raw, open, body, close) => {
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        return raw;
      }
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (!item || item["@type"] !== "BlogPosting") continue;
        if (Array.isArray(item.image)) {
          item.image = item.image.map(entry =>
            typeof entry === "string" ? toAbsolute(entry, origin) : entry
          );
        } else if (typeof item.image === "string") {
          item.image = toAbsolute(item.image, origin);
        }
        if (typeof item.thumbnailUrl === "string") {
          item.thumbnailUrl = toAbsolute(item.thumbnailUrl, origin);
        }
      }
      return open + JSON.stringify(data) + close;
    }
  );
}

// 无封面的文章：og:image 由头像换成默认封面（1200×630，更适合社交卡片）
function preferDefaultCover(html, origin) {
  const images = declaredImages(html, origin);
  if (images.length === 0) return html;
  const ogImage = html.match(/property="og:image" content="([^"]+)"/);
  if (!ogImage) return html;
  if (images.some(image => image === ogImage[1])) return html;
  return html.replace(
    /(property="og:image" content=")[^"]*(")/,
    (raw, head, tail) => head + images[0] + tail
  );
}

/**
 * 头像兜底换成默认封面 + 统一大卡片。
 * 判定「这张图是头像」用配置里的两个来源（站点 config.avatar 与主题
 * fallbacks.avatar），而不是猜尺寸——主题的兜底顺序写死在 head.ejs 里，
 * 只有头像和封面这两个值我们能确定。
 */
function preferCoverForSocialCards(html, origin) {
  const fallbacks = (hexo.theme && hexo.theme.config && hexo.theme.config.fallbacks) || {};
  const cover = fallbacks.cover ? toAbsolute(fallbacks.cover, origin) : null;
  const avatars = new Set(
    [hexo.config.avatar, fallbacks.avatar]
      .filter(value => typeof value === "string" && value.length > 0)
      .map(value => toAbsolute(value, origin))
  );
  let out = html;
  if (cover) {
    for (const attribute of ['property="og:image"', 'name="twitter:image"']) {
      const pattern = new RegExp(`(<meta\\s+${attribute}\\s+content=")([^"]*)(")`, "gi");
      out = out.replace(pattern, (whole, head, value, tail) =>
        avatars.has(value) ? head + cover + tail : whole);
    }
  }
  return out.replace(/(<meta\s+name="twitter:card"\s+content=")[^"]*(")/i,
    (whole, head, tail) => head + "summary_large_image" + tail);
}

hexo.extend.filter.register("after_render:html", html => {
  if (typeof html !== "string") return html;
  const origin = originOf(html);
  if (!origin) return html;
  let out = html;
  if (out.includes("application/ld+json")) out = preferDefaultCover(absolutizeJsonLd(out, origin), origin);
  return preferCoverForSocialCards(out, origin);
}, 8);

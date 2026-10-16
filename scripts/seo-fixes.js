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
 * 2. 文章没有封面时，og:image 用的是站点头像（1:1），而不是 fallbacks.cover。
 *    社交平台对 1200×630 的卡片图更友好，因此在「无封面」的文章上改用默认封面。
 *    判定依据是结构化数据里是否声明了封面；首页/页面不受影响。
 *
 * 只改 HTML 输出，不改动 Markdown 与主题文件。
 */

"use strict";

const ABSOLUTE_OR_DATA = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function originOf(html) {
  const match = html.match(/<link rel="canonical" href="([^"]+)"/);
  if (!match) return null;
  try {
    return new URL(match[1]).origin;
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

hexo.extend.filter.register("after_render:html", html => {
  if (typeof html !== "string" || !html.includes("application/ld+json")) return html;
  const origin = originOf(html);
  if (!origin) return html;
  return preferDefaultCover(absolutizeJsonLd(html, origin), origin);
}, 8);

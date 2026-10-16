/* global hexo */
/**
 * 拍摄参数卡片（构建期）
 *
 * 摄影站的文章，读者最想知道的往往不是排版而是「这张怎么拍的」。这个插件在文章
 * 正文末尾插一张参数卡，数据来源两个，前者优先：
 *
 *   1. `source/_data/photos.yml` 里手写的参数（键是文章文件名，即 slug）；
 *   2. 原始图片文件里的 EXIF（相机写进去的，不用手抄），用 exifr 读。
 *
 * 为什么手写的不放在 front-matter：Stellar 2.0 的 front-matter schema 是**封闭**的
 * （scripts/schema/content-config-rules.js 里逐字段声明），多写一个 `photo:` 会被判成
 * 「未知字段」丢掉，而且每次构建都告警一行。写进 `_data/photos.yml` 同样醒目、还不用
 * 和主题的 schema 打架——对一个「拍摄参数表」来说，集中放一处其实更好查。
 *
 * 为什么还要读 EXIF：本站照片在发布前被 `tools/optimize-images.mjs` 重压过，EXIF 已经
 * 被剥掉了（只剩尺寸标签），所以现有文章只能手写；以后直接丢进来的相机原片会自带
 * EXIF，卡片就能自己长出来。`_data/photos.yml` 里写的字段永远优先于 EXIF。
 *
 * 三条刻意的取舍：
 *   - **不输出 GPS**。EXIF 里的经纬度能精确到几米，发在公开网页上等于把家门的坐标写进
 *     Git 历史和搜索引擎。地点只认 front-matter 的 `location`，那是作者自己决定要不要公开的。
 *   - **EXIF 里的时间按相机记录的墙上时间输出**，不做时区换算（exifr 会把
 *     DateTimeOriginal 变成一个 Date，这里只取它的年月日时分，避免把拍摄时刻挪几个小时）。
 *   - **只读 `source/_posts/<slug>/` 下的原图**，不读产物里的变体（那些是 sharp 重编码的）。
 *
 * `tools/check-site.mjs` 会检查：`_data/photos.yml` 里写的每个字段都必须真的渲染到
 * 对应文章页上（写了不生效比不写更糟），卡片结构必须是带 `<h2>` 的 `<dl>`。
 */

"use strict";

const fs = require("fs");

const { sourceImageFiles } = require("./photo-index");

const FIELD_LABELS = [
  ["camera", "机身"],
  ["lens", "镜头"],
  ["focal", "焦距"],
  ["aperture", "光圈"],
  ["shutter", "快门"],
  ["iso", "感光度"],
  ["filter", "滤镜"],
  ["taken", "拍摄时间"],
  ["location", "地点"]
];

const CARD_CLASS = "photo-meta";

const CARD_CSS = `<style>
.${CARD_CLASS}{margin:2rem 0 0;padding:14px 16px;border:1px solid rgba(128,128,128,.25);border-radius:8px}
.${CARD_CLASS} h2{margin:0 0 10px;font-size:15px;font-weight:600;letter-spacing:.08em;opacity:.65}
.${CARD_CLASS} dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:6px 22px;margin:0}
.${CARD_CLASS} dl>div{display:flex;gap:10px;font-size:14px;line-height:1.7;margin:0}
.${CARD_CLASS} dt{flex:none;min-width:4.5em;opacity:.6}
.${CARD_CLASS} dd{margin:0;font-variant-numeric:tabular-nums;word-break:break-word}
</style>`;

/** 每个 slug 只读一次 EXIF；同一篇文章可能被渲染多次（首页卡片等）。 */
const exifCache = new Map();

/** 手写参数表：source/_data/photos.yml → { slug: { camera, lens, ... } }。 */
function manualParams(hexo) {
  const data = hexo.locals.get("data") || {};
  const photos = data.photos;
  return photos && typeof photos === "object" ? photos : {};
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function trimNumber(value) {
  return String(Math.round(value * 100) / 100);
}

/** f/8、1/200s、ISO 200、23mm 这类显示格式都在这里统一。 */
function formatField(key, value) {
  if (value === null || value === undefined || value === "") return "";
  switch (key) {
    case "camera": {
      const make = String(value.make || "").trim();
      const model = String(value.model || value).trim();
      if (!make) return model;
      return model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`;
    }
    case "aperture": {
      const number = Number(value);
      return Number.isFinite(number) ? `f/${trimNumber(number)}` : String(value);
    }
    case "shutter": {
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0) return String(value);
      if (number >= 1) return `${trimNumber(number)}s`;
      return `1/${Math.round(1 / number)}s`;
    }
    case "iso": {
      const number = Number(value);
      return Number.isFinite(number) ? `ISO ${trimNumber(number)}` : String(value);
    }
    case "focal": {
      const number = Number(value);
      return Number.isFinite(number) ? `${trimNumber(number)}mm` : String(value);
    }
    case "taken": {
      const date = value instanceof Date ? value : new Date(String(value).replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3"));
      if (Number.isNaN(date.getTime())) return String(value);
      const pad = number => String(number).padStart(2, "0");
      // 用本地年月日时分：DateTimeOriginal 是相机所在地的墙上时间，不做时区换算。
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
    default:
      return String(value);
  }
}

/** 读取一篇文章所有原图的 EXIF，先出现的字段先赢（一般是那张精修过的图）。 */
async function readExif(hexo, post) {
  if (exifCache.has(post.slug)) return exifCache.get(post.slug);
  const job = (async () => {
    let exifr;
    try {
      exifr = require("exifr");
    } catch {
      hexo.log.warn("拍摄参数：没装 exifr，只用手写的 front-matter");
      return {};
    }
    const files = sourceImageFiles(hexo, post);
    const merged = {};
    for (const file of files) {
      let data;
      try {
        data = await exifr.parse(fs.readFileSync(file), {
          pick: ["Make", "Model", "LensModel", "FNumber", "ExposureTime",
            "ISO", "FocalLength", "DateTimeOriginal"]
        });
      } catch (error) {
        hexo.log.debug(`拍摄参数：读不了 ${file}（${error.message}）`);
        continue;
      }
      if (!data) continue;
      if (!merged.make && data.Make) merged.make = String(data.Make).trim();
      if (!merged.model && data.Model) merged.model = String(data.Model).trim();
      if (!merged.lens && data.LensModel) merged.lens = String(data.LensModel).trim();
      if (merged.aperture === undefined && data.FNumber !== undefined) merged.aperture = data.FNumber;
      if (merged.shutter === undefined && data.ExposureTime !== undefined) merged.shutter = data.ExposureTime;
      if (merged.iso === undefined && data.ISO !== undefined) merged.iso = data.ISO;
      if (merged.focal === undefined && data.FocalLength !== undefined) merged.focal = data.FocalLength;
      if (merged.taken === undefined && data.DateTimeOriginal !== undefined) merged.taken = data.DateTimeOriginal;
    }
    if (merged.make || merged.model) {
      merged.camera = { make: merged.make, model: merged.model };
    }
    return merged;
  })();
  exifCache.set(post.slug, job);
  return job;
}

/** front-matter 覆盖 EXIF：作者写下的值永远优先。 */
function resolveFields(photo, exif) {
  const fields = [];
  for (const [key, label] of FIELD_LABELS) {
    const declared = photo[key];
    const value = declared !== undefined && declared !== null && declared !== ""
      ? declared
      : exif[key];
    const formatted = formatField(key, value);
    if (formatted) fields.push({ key, label, value: formatted });
  }
  return fields;
}

function renderCard(fields) {
  const rows = fields
    .map(field => `<div><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.value)}</dd></div>`)
    .join("");
  return `<div class="${CARD_CLASS}"><h2>拍摄参数</h2><dl>${rows}</dl></div>`;
}

/** 插在正文 article 的末尾（正文与标签/分享之间）。 */
function injectCard(html, card) {
  const open = /<article\b[^>]*class="[^"]*\bmd-text\b[^"]*"[^>]*>/i.exec(html);
  if (!open) return null;
  const end = html.indexOf("</article>", open.index + open[0].length);
  if (end < 0) return null;
  return html.slice(0, end) + card + html.slice(end);
}

hexo.extend.filter.register("after_render:html", async (html, data) => {
  if (typeof html !== "string") return html;
  const page = data && data.page;
  if (!page || page.layout !== "post" || !page.slug) return html;
  const declared = manualParams(hexo)[page.slug];
  if (declared === false) return html;
  const photo = declared && typeof declared === "object" ? declared : {};
  const fields = resolveFields(photo, await readExif(hexo, page));
  if (fields.length === 0) return html;
  const withCard = injectCard(html, renderCard(fields));
  if (!withCard) return html;
  if (withCard.includes(`.${CARD_CLASS}{`)) return withCard;
  return withCard.replace("</head>", `${CARD_CSS}</head>`);
}, 7);

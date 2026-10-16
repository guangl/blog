/* global hexo */
/**
 * 图片优化管线（构建期）
 *
 * 摄影站的主体流量就是照片。原图是相机直出（本站这张 7008×4672 的 main.jpg 有 4.1MB），
 * 直接塞进页面既浪费带宽也拖慢 LCP。这里在构建期做两件事：
 *
 *   1. **生成响应式变体**：每张「页面上真正用 <img> 显示的」照片生成多档宽度的
 *      JPEG / WebP / AVIF，写进产物目录（不提交进仓库）。编码用 sharp——它已经是
 *      主题的依赖（`hexo-theme-stellar` 依赖 sharp 0.34），这里只是显式声明进
 *      devDependencies，没有额外引入图像库。
 *   2. **改写 HTML**：把 `<img>` 包成 `<picture>`，给出 avif / webp 两组 srcset、
 *      第三组 jpg 作为 `<img>` 自身的 srcset，并补上 `width` / `height`（避免 CLS）。
 *
 * 三个刻意的取舍：
 *   - **只处理真正显示出来的图**。正文里「点击查看原图」的链接目标（main.jpg）
 *     不会进入 srcset，也就不必为它编码 7008px 的 AVIF——那是纯浪费。
 *     判断依据是渲染期真的改写到了它，所以 `after_render:html` 只做记录，
 *     编码放到 `after_generate` 里按记录执行。
 *   - **必须连 `<img>` 一起接管**，不能只加 `srcset`。主题的懒加载是「`src` 放 1×1
 *     占位图 + 真地址在 `data-src`」，由它的 vanilla-lazyload 在进入视口时替换 `src`；
 *     而 `<picture>` 的 `<source>` 一旦被浏览器选中，再改 `<img src>` 就没用了，
 *     两者会打架（占位图永久留下或图片被迫立刻加载）。所以这里把 `.lazy` 类与
 *     `data-src` 一起去掉，改用原生 `loading="lazy"`。
 *   - **装饰性大图改为立刻加载**。Hero 背景与文章页头图通常就是 LCP 元素，
 *     延后加载只会让 LCP 更差，所以给它们 `loading="eager"` + `fetchpriority="high"`。
 *
 * 只处理文章资源目录（`source/_posts/<slug>/`）里的图；站点图标、头像不参与。
 * 想压小 source/ 里的原图体积用 `bun run images:compress`（那是人工确认的操作）。
 *
 * `tools/check-site.mjs` 会顺着产物里的 srcset 逐个检查文件是否存在，
 * 所以变体少生成一个都会让构建失败。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

// 变体宽度档位。超过 MAX_WIDTH 的源图不会再生成更大的档，避免为 7008px 的原图
// 编码出没人用的 4K 变体；上限档由 MAX_WIDTH 与源图宽度共同决定。
const VARIANT_WIDTHS = [480, 960, 1600];
const MAX_WIDTH = 2560;
const FORMATS = [
  {
    ext: "avif",
    type: "image/avif",
    encode: pipeline => pipeline.avif({ quality: 50, effort: 4 })
  },
  {
    ext: "webp",
    type: "image/webp",
    encode: pipeline => pipeline.webp({ quality: 78 })
  },
  {
    ext: "jpg",
    type: "image/jpeg",
    encode: pipeline => pipeline.jpeg({ quality: 82, mozjpeg: true, progressive: true })
  }
];
// 同时编码的任务数。sharp 内部本来就用线程池，开太大反而抢 CPU。
const CONCURRENCY = 4;

const SOURCE_IMAGE = /\.(jpe?g|png)$/i;

/** publicUrl → { source, width, height, widths, outputDir, base } */
let manifest = new Map();
/** 变体编码中/已完成的 Promise，按 publicUrl 去重（多个页面会引用同一张图） */
const pending = new Map();
let ready = false;

function toPosix(value) {
  return value.split(path.sep).join("/");
}

/** 文章的输出目录：post.path 可能是 `2026/09/13/slug/` 或 `.../index.html`。 */
function outputDirOf(post) {
  return toPosix(post.path).replace(/index\.html$/, "").replace(/\/+$/, "");
}

function publicUrl(parts) {
  const root = (hexo.config.root || "/").replace(/\/?$/, "/");
  return root + toPosix(path.join(...parts));
}

/**
 * 扫文章资源目录，算出每张图可以生成哪些宽度。
 * 输出路径从 post.path 推导（`2026/09/13/slug/` → `2026/09/13/slug`），
 * 比按 permalink 规则拼字符串可靠。
 */
async function buildManifest() {
  const next = new Map();
  for (const post of hexo.locals.get("posts").toArray()) {
    const slug = post.slug;
    if (!slug) continue;
    const sourceDir = path.join(hexo.source_dir, "_posts", slug);
    if (!fs.existsSync(sourceDir)) continue;
    const outputDir = outputDirOf(post);
    if (!outputDir) {
      hexo.log.warn(`图片管线：推不出 ${slug} 的输出目录，跳过`);
      continue;
    }
    for (const name of fs.readdirSync(sourceDir).sort()) {
      if (!SOURCE_IMAGE.test(name)) continue;
      const source = path.join(sourceDir, name);
      let meta;
      try {
        meta = await sharp(source).metadata();
      } catch (error) {
        hexo.log.warn(`图片管线：读不了 ${toPosix(source)}（${error.message}），跳过`);
        continue;
      }
      if (!meta.width || !meta.height) continue;
      // 只保留比源图小的档位，最后补上「源图宽度与上限的较小值」作为最大档
      const widths = [...new Set([
        ...VARIANT_WIDTHS.filter(width => width < meta.width),
        Math.min(meta.width, MAX_WIDTH)
      ])].sort((a, b) => a - b);
      next.set(publicUrl([outputDir, name]), {
        source,
        width: meta.width,
        height: meta.height,
        widths,
        outputDir,
        base: name.replace(/\.[^.]+$/, "")
      });
    }
  }
  return next;
}

function variantUrl(entry, width, format) {
  return publicUrl([entry.outputDir, `${entry.base}-${width}.${format.ext}`]);
}

/**
 * 为一张图生成全部变体，结果按 URL 记忆化。
 *
 * 为什么在渲染期而不是 `after_generate`：Hexo 的 `after_generate` 跑在「路由建好、
 * 文件还没真正写完」的时刻（`_generate()` 里 `_routerRefresh()` 之后立刻触发），
 * 那时既不知道哪些图真的显示出来了，写进 public 的文件也可能还没轮到。放在
 * `after_render:html` 里、按「这张 HTML 真的引用了它」触发，时机和范围都正好。
 *
 * 副作用是编码发生在渲染管线里，所以必须 await——好在 Hexo 的 filter.exec 用的是
 * bluebird `Promise.method`，返回 Promise 会被等到。
 */
function ensureVariants(entry, url) {
  if (pending.has(url)) return pending.get(url);
  const job = (async () => {
    const output = hexo.public_dir;
    const tasks = [];
    for (const width of entry.widths) {
      for (const format of FORMATS) {
        const target = path.join(output, variantUrl(entry, width, format).replace(/^\/+/, ""));
        tasks.push({ width, format, target });
      }
    }
    let written = 0;
    let reused = 0;
    const queue = [...tasks];
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const task = queue.shift();
        if (!task) return;
        // 已存在且比源文件新的直接复用，方便反复 generate 而不 clean
        if (fs.existsSync(task.target)
          && fs.statSync(task.target).mtimeMs >= fs.statSync(entry.source).mtimeMs) {
          reused += 1;
          continue;
        }
        fs.mkdirSync(path.dirname(task.target), { recursive: true });
        await task.format
          .encode(sharp(entry.source).resize(task.width, null, { withoutEnlargement: true }))
          .toFile(task.target);
        written += 1;
      }
    }));
    hexo.log.debug(`图片管线：${toPosix(path.relative(hexo.base_dir, entry.source))} 生成 ${written} 个变体（复用 ${reused}）`);
  })();
  pending.set(url, job);
  return job;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * 还原属性里的 HTML 实体。
 * 列表页与首页的 `data-src` 会被 Hexo 转义成 `&#x2F;2026&#x2F;09&#x2F;...`
 * （文章页的同一属性却是裸路径），不还原就永远匹配不上 manifest。
 */
function decodeEntities(value) {
  return String(value)
    .replace(/&#x2F;|&#47;/gi, "/")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function withAttribute(tag, name, value) {
  const pattern = new RegExp(`\\s${name}="[^"]*"`, "i");
  if (pattern.test(tag)) return tag.replace(pattern, ` ${name}="${value}"`);
  return tag.replace(/<img\b/i, `<img ${name}="${value}"`);
}

function withoutAttribute(tag, name) {
  return tag.replace(new RegExp(`\\s${name}="[^"]*"`, "gi"), "");
}

/** 先删掉旧值再写，避免出现两个 width / height。 */
function withDimensions(tag, width, height) {
  return withoutAttribute(withoutAttribute(tag, "width"), "height")
    .replace(/<img\b/i, `<img width="${width}" height="${height}"`);
}

/** 按出现位置判断这张图是「全宽装饰背景」「列表卡片封面」还是「正文插图」。 */
function classify(html, offset, className) {
  const before = html.slice(Math.max(0, offset - 260), offset);
  const decorative = /wiki-cover-background/.test(className)
    || /(^|\s)bg(\s|$)/.test(className)
    || /aria-hidden="true"[^>]*>\s*$/.test(before);
  if (decorative) {
    // 主题会给图片 Hero 再叠一张 blur 图（底部渐隐用），它和主图是同一个地址、
    // 由浏览器缓存共享，没必要也标成高优先级，缓一缓无所谓。
    if (/blur/.test(className)) return { sizes: "100vw", loading: "lazy" };
    return { sizes: "100vw", loading: "eager", fetchpriority: "high" };
  }
  if (/post-cover[^>]*>\s*$/.test(before)) {
    return {
      sizes: "(max-width: 576px) 100vw, (max-width: 992px) 50vw, 360px",
      loading: "lazy"
    };
  }
  // 相册页的网格（scripts/gallery.js 注入，size=xl 固定两列）：不按网格给尺寸的话，
  // 手机会去下 1600px 的那一档。类名由注入方显式写上，比猜父容器可靠。
  if (/(^|\s)gallery-photo(\s|$)/.test(className)) {
    return { sizes: "(max-width: 992px) 50vw, 330px", loading: "lazy" };
  }
  return { sizes: "(max-width: 992px) 100vw, 860px", loading: "lazy" };
}

function pictureMarkup(entry, tag, context) {
  const srcsetOf = format => entry.widths
    .map(width => `${escapeAttr(variantUrl(entry, width, format))} ${width}w`)
    .join(", ");
  const sources = FORMATS
    .filter(format => format.ext !== "jpg")
    .map(format => `<source type="${format.type}" srcset="${srcsetOf(format)}" sizes="${context.sizes}">`)
    .join("");

  const largest = entry.widths[entry.widths.length - 1];
  let img = tag;
  // 去掉主题懒加载的钩子，改由原生 loading 控制
  img = withoutAttribute(img, "data-src");
  img = img.replace(/\sclass="([^"]*)"/i, (whole, value) => {
    const kept = value.split(/\s+/).filter(name => name && name !== "lazy").join(" ");
    return kept ? ` class="${kept}"` : "";
  });
  for (const attribute of ["loading", "decoding", "src", "srcset", "sizes", "fetchpriority"]) {
    img = withoutAttribute(img, attribute);
  }
  img = withDimensions(img, entry.width, entry.height);
  // <img> 自己带 jpg 的 srcset：既不支持 avif 也不支持 webp 的浏览器也能挑尺寸
  img = withAttribute(img, "src", variantUrl(entry, largest, FORMATS[2]));
  img = withAttribute(img, "srcset", srcsetOf(FORMATS[2]));
  img = withAttribute(img, "sizes", context.sizes);
  img = withAttribute(img, "loading", context.loading);
  img = withAttribute(img, "decoding", context.fetchpriority ? "sync" : "async");
  if (context.fetchpriority) img = withAttribute(img, "fetchpriority", context.fetchpriority);
  return `<picture>${sources}${img}</picture>`;
}

async function rewrite(html) {
  // 先扫一遍确定这张页面要用哪些图，并把变体编码做完，再统一替换
  const jobs = [];
  const matches = [];
  const pattern = /<img\b[^>]*>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[0];
    const src = (/\bsrc="([^"]*)"/i.exec(tag) || [])[1]
      || (/\bdata-src="([^"]*)"/i.exec(tag) || [])[1];
    if (!src) continue;
    const url = decodeEntities(src);
    const entry = manifest.get(url);
    if (!entry) continue;
    const className = (/\bclass="([^"]*)"/i.exec(tag) || [])[1] || "";
    matches.push({ offset: match.index, tag, context: classify(html, match.index, className), entry, url });
    jobs.push(ensureVariants(entry, url));
  }
  if (matches.length === 0) return html;
  await Promise.all(jobs);

  const byOffset = new Map(matches.map(item => [item.offset, pictureMarkup(item.entry, item.tag, item.context)]));
  return html.replace(/<img\b[^>]*>/gi, (tag, offset) => byOffset.get(offset) ?? tag);
}

hexo.extend.filter.register("before_generate", async () => {
  manifest = await buildManifest();
  pending.clear();
  ready = true;
});

hexo.extend.filter.register("after_render:html", html => {
  if (!ready || typeof html !== "string" || !html.includes("<img")) return html;
  return rewrite(html);
}, 8);

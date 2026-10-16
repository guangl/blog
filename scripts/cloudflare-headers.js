/* global hexo */
/**
 * 生成 Cloudflare Pages 的 `_headers`（构建期）
 *
 * 为什么用脚本生成，而不是直接放 `source/_headers`：
 *   Hexo 会忽略 `source/` 下以 `_` 开头的文件和目录（`_posts`、`_data` 是特例），
 *   所以 `source/_headers` 根本不会被复制进产物，Cloudflare 也就读不到。
 *   放到 `after_generate` 里写文件最直接，而且 `public/` 与 `public-domain/`
 *   两个输出目录都能覆盖。
 *
 * 这里做两件事：
 *   1. **安全响应头**：HSTS、CSP、X-Frame-Options、Permissions-Policy 等。
 *      这些 Cloudflare Pages 默认不给，只有 x-content-type-options / referrer-policy
 *      之类的少数几条。CSP 里必须显式放行主题运行时按需加载的第三方脚本
 *      （mermaid / marked / vanilla-lazyload 走 jsdelivr，swiper 走 unpkg，
 *      MathJax 走 cdnjs），以及首页仓库卡片拉取 GitHub API 的 connect-src。
 *   2. **缓存策略**：Pages 默认给所有静态资源 `max-age=14400, must-revalidate`。
 *      这里给 CSS / JS / 图片一周的 stale-while-revalidate，HTML 保持不缓存。
 *      注意 `_headers` 只能按路径匹配、看不到查询串，而主题的资源指纹放在
 *      `?v=` 里，所以不能声明 immutable：路径没变时换图会有一周的缓存窗口。
 *
 * ⚠️ CSP 里含 `'unsafe-inline'`（主题有内联脚本与内联样式，且是构建期注入的），
 * 它挡不住内联脚本注入，但仍能挡住「本站没有显式放行的外部脚本来源」。
 * 想再收紧就得给每段内联脚本算 hash，属于以后的事。
 * 以后接入评论服务（Giscus / Waline 等）时，必须把对应域名加进 frame-src / script-src，
 * 否则会被 CSP 直接拦掉。
 *
 * `tools/check-site.mjs` 会检查这个文件和关键头是否存在；
 * `node tools/browser-check.mjs /examples/` 会在本地按同一份 `_headers`
 * 起服务并回报 CSP 违规，用来确认没有把站点自己的资源挡掉。
 */

"use strict";

const fs = require("fs");
const path = require("path");

// 主题运行时按需加载的第三方来源（见 public/js/runtime/extensions/）
const SCRIPT_SOURCES = [
  "'self'",
  "'unsafe-inline'",
  "https://gcore.jsdelivr.net", // mermaid、marked、vanilla-lazyload
  "https://unpkg.com", // swiper
  "https://cdnjs.cloudflare.com" // MathJax（仅含公式的页面）
];

// 样式表来源。除了本站与内联样式，还要放行 jsdelivr：主题的 lightbox 扩展在页面出现
// `[data-fancybox]`（相册页、以后正文里的图集）时才按需挂载，并从那里拉 Fancybox 的 CSS。
// 不放行的话灯箱样式表被拦、点了没反应，而且只有打开相册页才会暴露——2026-10-17 实测到的。
const STYLE_SOURCES = [
  "'self'",
  "'unsafe-inline'",
  "https://gcore.jsdelivr.net" // Fancybox（@fancyapps/ui）
];

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src ${SCRIPT_SOURCES.join(" ")}`,
  `style-src ${STYLE_SOURCES.join(" ")}`,
  "img-src 'self' data:",
  // MathJax 的公式字形是从 cdnjs 拉的 woff，不放行就只剩豆腐块
  "font-src 'self' data: https://cdnjs.cloudflare.com",
  "media-src 'self'",
  "frame-src 'self'",
  "connect-src 'self' https://api.github.com", // 首页 / 侧栏的仓库信息卡片
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests"
].join("; ");

// 一年期 HSTS。刻意不加 preload：裸域目前没有 HTTPS 服务，进 preload 列表要连带
// 保证所有子域常年 HTTPS，等大陆备案与全站 HTTPS 都稳定后再考虑。
const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";

const SECURITY_HEADERS = {
  "Strict-Transport-Security": STRICT_TRANSPORT_SECURITY,
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  // 只允许本站资源被本站页面引用，避免被其它站当图床 / 脚本源
  "Cross-Origin-Resource-Policy": "same-origin"
};

// 缓存策略。两条 Cloudflare 的规则决定了这里必须「按扩展名、且互不重叠」地分组：
//   1. `*` 是贪婪通配，能跨 `/` 匹配（官方文档：a splat will greedily match all characters），
//      所以 `/*.jpg` 能覆盖到文章资源目录里的深层图片路径；
//   2. **同一个头命中多条规则时，值会用逗号拼在一起**。`/*` 上再写一条 Cache-Control
//      就会和下面这些规则拼成 `public, max-age=0, ..., public, max-age=86400, ...`
//      这种语义不明的东西。所以 `/*` 那条只放安全头，不放 Cache-Control——
//      HTML 继续用 Cloudflare Pages 的默认值（实测是 `public, max-age=0, must-revalidate`，
//      正是文档页想要的「每次都回源校验」）。
// 各条之间不能有交集，所以图标 JSON 用目录规则、搜索索引用精确路径，不写 `/*.json`。
const ASSET_CACHE = "public, max-age=86400, stale-while-revalidate=604800";
const FEED_CACHE = "public, max-age=3600, stale-while-revalidate=86400";

const CACHE_RULES = [
  ["/*.css", ASSET_CACHE],
  ["/*.js", ASSET_CACHE],
  ["/*.jpg", ASSET_CACHE],
  ["/*.jpeg", ASSET_CACHE],
  ["/*.png", ASSET_CACHE],
  ["/*.webp", ASSET_CACHE],
  ["/*.avif", ASSET_CACHE],
  ["/*.svg", ASSET_CACHE],
  ["/*.ico", ASSET_CACHE],
  ["/*.gif", ASSET_CACHE],
  ["/js/icons/*", ASSET_CACHE],
  ["/search.json", FEED_CACHE],
  ["/*.xml", FEED_CACHE],
  ["/robots.txt", FEED_CACHE]
];

function renderHeadersFile() {
  const blocks = [];
  blocks.push(["/*", SECURITY_HEADERS]);
  for (const [pattern, cacheControl] of CACHE_RULES) {
    blocks.push([pattern, { "Cache-Control": cacheControl }]);
  }
  return blocks
    .map(([pattern, headers]) => [
      pattern,
      ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`)
    ].join("\n"))
    .join("\n\n") + "\n";
}

hexo.extend.filter.register("after_generate", () => {
  const output = hexo.public_dir;
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "_headers"), renderHeadersFile());
});

/* global hexo */
/**
 * 备案号页脚（构建期）
 *
 * 大陆备案通过后，《互联网信息服务管理办法》要求在网站底部展示备案号并链接到
 * 工信部备案系统；公安联网备案号同理。号码由 `_config.yml` 的 `beian` 段提供，
 * **留空时完全不输出**，所以本地开发、海外构建和 Cloudflare Pages 都照旧。
 *
 * 为什么用 after_render:html 改产物：
 *   主题的页脚内容来自 `footer.content`，而那部分配置在主题初始化时就被
 *   `Object.freeze` 冻结了（`hexo.stellar.config.footer` 不可写），构建期无法追加；
 *   主题自己的 inject 只有 bodyBegin / bodyEnd 两个槽位，不在页脚里。
 *   所以这里沿用 `scripts/lazy-images.js`、`math-protect.js`、`seo-fixes.js`
 *   的同一套路：只改渲染出来的 HTML，不动主题文件。
 *
 * 插入位置是页脚 `.text` 区块的末尾（`</div></footer>` 之前），这样备案号会跟在
 * 版权行后面、共用页脚样式。主题若改掉这段结构，插入会静默跳过，而
 * `tools/check-site.mjs` 里「配了就必须出现」的自检会立刻报出来。
 */

"use strict";

const MIIT_URL = "https://beian.miit.gov.cn/";
const POLICE_URL = "https://beian.mps.gov.cn/";

// 页脚末尾的锚点，插在它前面就等于接在版权行后面
const FOOTER_ANCHOR = "</div></footer>";

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function beianLink(text, url) {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`;
}

function beianFooterLine() {
  const beian = hexo.config.beian || {};
  const links = [];
  const icp = trimmed(beian.icp);
  const police = trimmed(beian.police);

  if (icp) links.push(`ICP 备案：${beianLink(icp, MIIT_URL)}`);
  if (police) links.push(beianLink(police, trimmed(beian.police_url) || POLICE_URL));
  return links.length > 0 ? `<p>${links.join(" ")}</p>` : "";
}

hexo.extend.filter.register("after_render:html", html => {
  const line = beianFooterLine();
  if (!line) return html;
  // 404 之类的页面没有页脚，直接放过
  if (!html.includes("page-footer") || !html.includes(FOOTER_ANCHOR)) return html;
  return html.replace(FOOTER_ANCHOR, `${line}${FOOTER_ANCHOR}`);
});

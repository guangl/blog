/* global hexo */
/**
 * 关闭主题的「非法克隆站 / 官方备用站」提示（构建期）
 *
 * 主题的 canonicalCheck（node_modules/hexo-theme-stellar/source/js/main.js）在
 * 「当前主机 ≠ 主站主机」时会盖一层浮层：主机在 canonical.allowed_hosts 里就提示
 * 「本站为官方备用站，仅供应急」，否则提示「本站为非法克隆站」；两种情况都会顺手
 * 往 <head> 插一个 <meta name="robots" content="noindex, nofollow">。
 *
 * 本站同时由 blog.guangluo.top、Cloudflare Pages 域名、裸域 / www 和大陆 ECS 的
 * 公网 IP 提供服务，那层提示在任何备用入口都会出现，因此按需求整体关掉。
 *
 * 主题没有开关，而判定要求「当前主机 == canonical 主机」才静默，纯静态配置做不到；
 * 所以注入一段内联脚本，在主题的 main.js（defer）执行**之前**清掉客户端判定数据里的
 * host / encoded。canonicalCheck 的第一行就是 `if (!getOriginalHost()) return`，
 * 于是任何主机上都不再提示，也不会再插 noindex。
 *
 * 页面里的 <link rel="canonical"> 仍由主题按 canonical.host 正常输出，不受影响。
 * 想恢复提示：删掉这个文件即可（_config.stellar.yml 里的 canonical 配置都还在）。
 */

"use strict";

const MARKER = "data-stellar-no-canonical-tip";
const SNIPPET = `<script ${MARKER}>
(() => {
  const canonical = window.canonical || (window.stellarClientData && window.stellarClientData.canonical);
  if (!canonical) return;
  canonical.host = null;
  canonical.encoded = null;
})();
<\/script>`;

hexo.extend.filter.register("after_render:html", html => {
  if (html.includes(MARKER)) return html;          // 幂等：重复触发不叠加
  if (!html.includes("</body>")) return html;      // 404 之类的独立文档也要能命中，这里只做兜底
  return html.replace("</body>", `${SNIPPET}</body>`);
});

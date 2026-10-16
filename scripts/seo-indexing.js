/* global hexo */
/**
 * 搜索引擎收录支持（构建期）
 *
 * 两件事，全部由 `_config.yml` 的 `seo` 段驱动，默认值不改变现有页面：
 *
 * 1. 站长平台验证：把 `seo.verification` 里的令牌输出成对应的验证 meta。
 *    只有填了值的平台才输出，目前支持 Google 和 Bing。
 *    百度搜索资源平台等域名备案后再接，加一条映射即可。
 *
 * 2. IndexNow：把 `seo.indexnow_key` 生成为站点根目录的 `<key>.txt`。
 *    Bing、Yandex、Seznam、Naver 靠这个文件核验密钥，不需要登录站长平台；
 *    部署后的 URL 推送由 `tools/ping-search.mjs` 负责。
 */

"use strict";

// [配置键, meta name]；meta 名称以各站长平台给出的验证代码为准。
const VERIFICATION_META = [
  ["google", "google-site-verification"],
  ["bing", "msvalidate.01"]
];

function seoConfig() {
  return (hexo.config && hexo.config.seo) || {};
}

function escapeAttribute(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function verificationTags() {
  const verification = seoConfig().verification || {};
  return VERIFICATION_META.flatMap(([key, name]) => {
    const token = verification[key];
    if (typeof token !== "string" || token.trim() === "") return [];
    return [`<meta name="${name}" content="${escapeAttribute(token.trim())}">`];
  });
}

const headTags = verificationTags();
if (headTags.length > 0) {
  hexo.extend.injector.register("head_end", headTags.map(tag => `  ${tag}`).join("\n"));
}

hexo.extend.generator.register("indexnow-key", () => {
  const key = seoConfig().indexnow_key;
  if (typeof key !== "string" || key.trim() === "") return [];
  return [{ path: `${key.trim()}.txt`, data: key.trim() }];
});

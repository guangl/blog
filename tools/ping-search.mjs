#!/usr/bin/env node
/**
 * 部署后把站点 URL 推送给搜索引擎。
 *
 * - IndexNow：把构建产物 sitemap.xml 里的 URL 推送给 api.indexnow.org
 *   （Bing、Yandex、Seznam、Naver 共用）。用的是 `_config.yml` 的 `seo.indexnow_key`，
 *   密钥文件由 `scripts/seo-indexing.js` 生成，不需要登录任何站长平台。
 * - 百度搜索资源平台的普通收录推送等域名备案后再接：
 *   那时加一个 notifyBaidu()，向 https://data.zz.baidu.com/urls?site=&token= POST 换行分隔的 URL。
 *
 * 用法：
 *   node tools/ping-search.mjs _config.domain.yml             # 推送
 *   node tools/ping-search.mjs _config.domain.yml --dry-run    # 只打印将要发送的内容
 *   node tools/ping-search.mjs _config.domain.yml --strict     # 推送失败即返回非零
 *
 * 默认非严格模式：第三方接口抖动不应该让一次成功的发布变成失败。
 */

import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { load } from 'cheerio';
import yaml from 'js-yaml';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(argument => argument.startsWith('--')));
const configFiles = argv.filter(argument => !argument.startsWith('--'));
const dryRun = flags.has('--dry-run');
const strict = flags.has('--strict');

const config = Object.assign({}, ...['_config.yml', ...configFiles]
  .map(path => yaml.load(readFileSync(path, 'utf8'))));
const seo = config.seo || {};
const output = resolve(config.public_dir);
const site = new URL(config.url.replace(/\/?$/, '/'));
const sitemapPath = resolve(output, 'sitemap.xml');
const failures = [];

if (!existsSync(sitemapPath)) {
  console.error(`找不到 ${relative(process.cwd(), sitemapPath)}：先执行 bun run verify:domain 生成站点。`);
  process.exit(1);
}

const sitemap = load(readFileSync(sitemapPath, 'utf8'), { xmlMode: true });
const urls = sitemap('loc').toArray().map(element => sitemap(element).text().trim()).filter(Boolean);

console.log(`${dryRun ? '[试运行] ' : ''}站点 ${site.origin}，待推送 ${urls.length} 条 URL。`);
if (urls.length === 0) {
  console.error('sitemap.xml 里没有 URL，停止推送。');
  process.exit(1);
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// IndexNow 会回源校验密钥文件，先确认线上能读到，避免推送被 403 拒掉。
async function keyFileIsLive(key, keyLocation) {
  const attempts = Number(process.env.INDEXNOW_KEY_ATTEMPTS || 5);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(keyLocation, { cache: 'no-store' });
      const body = response.ok ? (await response.text()).trim() : '';
      if (response.ok && body === key) return true;
      console.warn(`  · 第 ${attempt}/${attempts} 次检查 ${keyLocation}：HTTP ${response.status}`);
    } catch (error) {
      console.warn(`  · 第 ${attempt}/${attempts} 次检查失败：${error.message}`);
    }
    if (attempt < attempts) await sleep(3000);
  }
  return false;
}

async function notifyIndexNow() {
  const key = (process.env.INDEXNOW_KEY || seo.indexnow_key || '').trim();
  if (!key) {
    console.log('- IndexNow：未配置 seo.indexnow_key，跳过。');
    return;
  }
  const keyLocation = new URL(`${key}.txt`, site).href;
  const payload = { host: site.host, key, keyLocation, urlList: urls };
  if (dryRun) {
    console.log(`- IndexNow：将以密钥 ${key} 推送 ${urls.length} 条 URL，密钥文件 ${keyLocation}。`);
    return;
  }
  if (!(await keyFileIsLive(key, keyLocation))) {
    console.warn(`- IndexNow：${keyLocation} 暂时读不到配置的密钥，仍尝试推送，若被拒绝请发布后重跑。`);
  }
  const endpoints = [process.env.INDEXNOW_ENDPOINT, 'https://api.indexnow.org/indexnow', 'https://www.bing.com/indexnow']
    .filter(Boolean);
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const body = (await response.text()).replace(/\s+/g, ' ').slice(0, 200);
      if (response.ok) {
        console.log(`- IndexNow：${endpoint} 返回 ${response.status}，已提交 ${urls.length} 条 URL。`);
        return;
      }
      console.warn(`- IndexNow：${endpoint} 返回 ${response.status} ${body}`);
    } catch (error) {
      console.warn(`- IndexNow：${endpoint} 请求失败：${error.message}`);
    }
  }
  failures.push('IndexNow');
}

await notifyIndexNow();

if (failures.length > 0) {
  const message = `推送未完成：${failures.join('、')}。Google 已在 2023 年停止 sitemap ping，请在 Search Console 里手动提交。`;
  if (strict) {
    console.error(message);
    process.exit(1);
  }
  console.warn(message);
}

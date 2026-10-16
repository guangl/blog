#!/usr/bin/env node
/**
 * 本地浏览器核对工具（可选，不进 CI）
 *
 * 用途：`_headers` 里的 CSP 只在 Cloudflare Pages 上生效，Markdown 改动对无障碍、
 * 对比度的影响也只有真正渲染一遍才看得准。这个脚本把 `public/` 用本地 HTTP 服务
 * 起起来、按 `_headers` 的规则补上响应头，再用无头 Chrome 打开页面，回传：
 *
 *   - 控制台错误与 `securitypolicyviolation`（CSP 是否挡住了站点自己的资源）
 *   - 每个页面的 h1 数量与文本、缺 alt 的图片
 *   - Hero 标题的实际对比度（先隐藏标题截图，取标题所在区域的平均亮度再算比值）
 *
 * 用法：
 *   node tools/browser-check.mjs                 # 检查首页
 *   node tools/browser-check.mjs /posts/ /about/ # 检查多个路径
 *   node tools/browser-check.mjs --no-headers /  # 忽略 _headers
 *   node tools/browser-check.mjs --dark /        # 按深色外观检查（默认浅色）
 *   node tools/browser-check.mjs --shot /tmp/a-{scheme}.png /  # 顺便存一张截图
 *
 * 需要本机有 Chrome（用 CHROME 环境变量可指定路径）。这是本地工具，
 * 依赖 Chrome 与 sharp，不放进 `bun run verify`。
 */

"use strict";

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, extname, normalize } from "node:path";
import sharp from "sharp";

const CHROME_CANDIDATES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome",
  "chromium"
].filter(Boolean);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon"
};

function parseArgs(argv) {
  const paths = [];
  let dir = "public";
  let headers = true;
  let scheme = "light";
  let shot = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") dir = argv[++i];
    else if (arg === "--shot") shot = argv[++i];
    else if (arg === "--no-headers") headers = false;
    else if (arg === "--dark") scheme = "dark";
    else if (arg === "--light") scheme = "light";
    else if (arg.startsWith("--")) throw new Error(`未知参数：${arg}`);
    else paths.push(arg);
  }
  return { dir: resolve(dir), headers, scheme, shot, paths: paths.length > 0 ? paths : ["/"] };
}

/**
 * 解析 Cloudflare Pages 的 `_headers` 文件：
 *   /path/*
 *     Header-Name: value
 * 只实现本站用到的形态（前缀通配 + 单段 `*`），不做完整规范实现。
 */
function parseHeadersFile(file) {
  if (!existsSync(file)) return [];
  const rules = [];
  let current = null;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (/^\s*#/.test(raw)) continue;
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: {} };
      rules.push(current);
      continue;
    }
    const separator = line.indexOf(":");
    if (!current || separator < 0) continue;
    current.headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return rules;
}

function patternMatches(pattern, pathname) {
  // Cloudflare 的 `*` 是贪婪通配，能跨 `/` 匹配（官方文档：greedily match all characters），
  // 一个 URL 里只允许一个 `*`。本地按同样的语义模拟，否则会误判深层资源没被匹配。
  if (pattern.includes("*")) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(pathname);
  }
  return pattern === pathname;
}

function headersFor(rules, pathname) {
  const merged = {};
  for (const rule of rules) {
    if (patternMatches(rule.pattern, pathname)) Object.assign(merged, rule.headers);
  }
  return merged;
}

function startServer(dir, rules) {
  const server = createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch {
      response.writeHead(400).end("bad request");
      return;
    }
    if (pathname.endsWith("/")) pathname += "index.html";
    const target = resolve(dir, `.${normalize(pathname)}`);
    if (!target.startsWith(dir) || !existsSync(target)) {
      const notFound = join(dir, "404.html");
      const headers = headersFor(rules, pathname);
      if (existsSync(notFound)) {
        response.writeHead(404, { "content-type": MIME[".html"], ...headers });
        response.end(readFileSync(notFound));
      } else {
        response.writeHead(404, headers).end("not found");
      }
      return;
    }
    const headers = headersFor(rules, pathname);
    response.writeHead(200, { "content-type": MIME[extname(target)] || "application/octet-stream", ...headers });
    response.end(readFileSync(target));
  });
  return new Promise(ready => {
    server.listen(0, "127.0.0.1", () => ready({ server, port: server.address().port }));
  });
}

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate.includes("/") && existsSync(candidate)) return candidate;
    if (!candidate.includes("/")) {
      const found = process.env.PATH.split(":").map(dir => join(dir, candidate)).find(existsSync);
      if (found) return found;
    }
  }
  throw new Error("找不到 Chrome，用 CHROME=/path/to/chrome 指定。");
}

/** 极简 CDP 客户端：够用就好，不引入 puppeteer。 */
class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve: done, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else done(message.result);
      } else if (message.method) {
        for (const listener of this.listeners) listener(message);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve_, reject) => this.pending.set(id, { resolve: resolve_, reject }));
  }

  on(listener) {
    this.listeners.push(listener);
  }

  waitFor(method, timeout = 15000) {
    return new Promise((resolve_, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待 ${method} 超时`)), timeout);
      const listener = message => {
        if (message.method !== method) return;
        clearTimeout(timer);
        this.listeners = this.listeners.filter(item => item !== listener);
        resolve_(message.params);
      };
      this.on(listener);
    });
  }
}

const AUDIT = `(() => {
  const describe = el => (el.getAttribute('class') || '') + '|' + (el.textContent || '').trim().slice(0, 40);
  const headings = [...document.querySelectorAll('h1')].map(describe);
  const images = [...document.querySelectorAll('img')].map(img => ({
    src: (img.currentSrc || img.getAttribute('src') || '').slice(0, 90),
    alt: img.getAttribute('alt'),
    cls: img.getAttribute('class') || ''
  }));
  const missingAlt = images.filter(image => image.alt === null).length;
  // srcset 里少一个变体就是裂图，而裂图在纯文本检查里看不出来
  const elements = [...document.querySelectorAll('img')];
  const broken = elements
    .filter(img => img.complete && img.naturalWidth === 0)
    .map(img => img.currentSrc || img.getAttribute('src') || '');
  const loaded = elements
    .filter(img => img.complete && img.naturalWidth > 0)
    .map(img => (img.currentSrc || '').split('/').pop());
  // 压在照片上的文字都要单独量：标题是大字（3:1 即可），简介 / 元信息 / 按钮是小字（要 4.5:1）。
  // 两组：首页与 Wiki 页的图片 Hero，以及文章页顶部的 banner。
  const TEXT_SELECTOR = [
    '.cover-content.wiki-hero .cover-title',
    '.cover-content.wiki-hero .description',
    '.cover-content.wiki-hero .wiki-cover-actions a',
    '.cover-content.wiki-hero .wiki-navbar a',
    '.cover-content.wiki-hero .wiki-cover-release',
    '.article.banner .content .title',
    '.article.banner .content .subtitle',
    '.article.banner .content .meta-row',
    '.article.banner .content .reading',
    '.article.banner .bread-nav'
  ].join(', ');
  const heroTexts = [...document.querySelectorAll(TEXT_SELECTOR)].map(el => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    // 主题的「主按钮」（源码）是 background: var(--text-banner) + 子元素 filter: invert(1)，
    // 肉眼看到的是反色后的文字，量对比度时必须算进去，否则会得出「白字白底」的假结论。
    const inverted = [el, ...el.querySelectorAll('*')]
      .some(node => /invert\\(1\\)/.test(getComputedStyle(node).filter || ''));
    // 打个临时标记，等下按标记整体隐藏再截图（visibility 不改布局，坐标仍然有效）
    el.setAttribute('data-a11y-sample', '1');
    return {
      label: (el.getAttribute('class') || el.tagName) + '|' + (el.textContent || '').trim().slice(0, 24),
      color: style.color,
      inverted,
      background: style.backgroundColor,
      fontSize: parseFloat(style.fontSize),
      fontWeight: style.fontWeight,
      x: box.x, y: box.y, width: box.width, height: box.height
    };
  }).filter(item => item.width > 1 && item.height > 1);
  const title = document.querySelector('.bottom.only-title .title');
  return {
    lang: document.documentElement.lang,
    h1Count: headings.length,
    h1: headings,
    imageCount: images.length,
    missingAlt,
    broken,
    loaded,
    pictureCount: document.querySelectorAll('picture').length,
    srcsetCount: document.querySelectorAll('[srcset]').length,
    // 只证明「没被拦」还不够：这三项证明第三方脚本真的执行完了
    mathTypeset: document.querySelectorAll('mjx-container').length,
    mermaidSvg: document.querySelectorAll('pre.mermaid svg, .mermaid svg').length,
    stillLoading: document.querySelectorAll('.is-loading').length,
    externalScripts: [...document.querySelectorAll('script[src]')]
      .map(script => script.src)
      .filter(src => src && !src.startsWith(location.origin))
      .map(src => new URL(src).origin),
    heroTexts,
    pageTitleFontSize: title ? getComputedStyle(title).fontSize : null,
    pageTitleTag: title ? title.tagName : null
  };
})()`;

function relativeLuminance([r, g, b]) {
  const channel = value => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function parseColor(value) {
  const match = /rgba?\(([^)]+)\)/.exec(value || "");
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
}

function contrastRatio(a, b) {
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

async function main() {
  const { dir, headers, scheme, shot, paths } = parseArgs(process.argv.slice(2));
  if (!existsSync(join(dir, "index.html"))) throw new Error(`${dir} 里没有 index.html，先构建。`);

  const rules = headers ? parseHeadersFile(join(dir, "_headers")) : [];
  const { server, port } = await startServer(dir, rules);
  const base = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "dsh-chrome-"));
  const chrome = spawn(findChrome(), [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    // 受限环境（容器 / 文件沙箱）里 Chrome 自己的沙箱会起不来，本地工具直接关掉。
    "--no-sandbox",
    "--disable-crash-reporter",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--window-size=1280,900",
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const cleanup = () => {
    chrome.kill("SIGKILL");
    server.close();
  };

  try {
    const portFile = join(profile, "DevToolsActivePort");
    const deadline = Date.now() + 15000;
    while (!existsSync(portFile)) {
      if (Date.now() > deadline) throw new Error("Chrome 没有在 15 秒内启动。");
      await new Promise(done => setTimeout(done, 100));
    }
    const debugPort = readFileSync(portFile, "utf8").split("\n")[0].trim();
    // 必须连到 page 目标：浏览器级端点没有 Page / Runtime 这些域。
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    let page = targets.find(target => target.type === "page");
    if (!page) {
      page = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
    }
    const { webSocketDebuggerUrl } = page;
    const socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise((done, fail) => {
      socket.addEventListener("open", done, { once: true });
      socket.addEventListener("error", () => fail(new Error("WebSocket 连接失败")), { once: true });
    });
    const cdp = new CDP(socket);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    // 站点外观是「跟随系统」，用媒体模拟分别量浅色与深色
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: scheme }]
    });
    // 在页面脚本之前挂上 CSP 违规收集器
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', event => {
          window.__cspViolations.push(event.violatedDirective + ' <- ' + event.blockedURI);
        });`
    });

    for (const path of paths) {
      const problems = [];
      cdp.on(message => {
        if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params.entry.level)) {
          problems.push(`[${message.params.entry.level}] ${message.params.entry.text}`);
        }
        if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
          problems.push(`[console] ${message.params.args.map(arg => arg.value || arg.description || "").join(" ")}`);
        }
        if (message.method === "Runtime.exceptionThrown") {
          problems.push(`[exception] ${message.params.exceptionDetails.text}`);
        }
      });
      const loaded = cdp.waitFor("Page.loadEventFired");
      await cdp.send("Page.navigate", { url: `${base}${path}` });
      await loaded;
      await new Promise(done => setTimeout(done, 1200)); // 等运行时扩展与懒加载把图换上

      if (shot) {
        const captured = await cdp.send("Page.captureScreenshot", { format: "png" });
        const { writeFileSync } = await import("node:fs");
        const slug = path.replace(/^\/+|\/+$/g, "").replace(/[^\w.-]+/g, "_") || "index";
        const target = shot.replace("{scheme}", scheme).replace("{page}", slug);
        writeFileSync(target, Buffer.from(captured.data, "base64"));
        console.log(`  截图已保存：${target}`);
      }

      const { result } = await cdp.send("Runtime.evaluate", { expression: AUDIT, returnByValue: true });
      const violations = await cdp.send("Runtime.evaluate", {
        expression: "window.__cspViolations || []", returnByValue: true
      });
      const audit = result.value;

      console.log(`\n=== ${path} （${scheme}）===`);
      console.log(`html lang=${audit.lang} | h1=${audit.h1Count} | img=${audit.imageCount}（缺 alt ${audit.missingAlt}）| picture=${audit.pictureCount} srcset=${audit.srcsetCount}`);
      audit.h1.forEach((heading, index) => console.log(`  h1[${index}] ${heading}`));
      console.log(`  页面标题：<${audit.pageTitleTag}> font-size=${audit.pageTitleFontSize}`);
      console.log(`  实际加载：${audit.loaded.join(", ") || "无"}`);
      if (audit.broken.length) console.log(`  ⚠ 裂图 ${audit.broken.length} 张：${audit.broken.join(", ")}`);
      console.log(`  第三方脚本：${audit.externalScripts.length ? [...new Set(audit.externalScripts)].join(", ") : "无"}`
        + ` | MathJax 排版 ${audit.mathTypeset} 处 | Mermaid 图 ${audit.mermaidSvg} 个 | 仍在 loading ${audit.stillLoading}`);

      if (audit.heroTexts.length > 0) {
        // 把这些文字整体隐藏再截图（visibility 不改布局），量到的就是文字背后的真实底色
        await cdp.send("Runtime.evaluate", {
          expression: `document.querySelectorAll('[data-a11y-sample]').forEach(el => { el.style.visibility = 'hidden'; })`
        });
        const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
        await cdp.send("Runtime.evaluate", {
          expression: `document.querySelectorAll('[data-a11y-sample]').forEach(el => { el.style.visibility = ''; el.removeAttribute('data-a11y-sample'); })`
        });
        const image = sharp(Buffer.from(shot.data, "base64"));
        const { width: imageWidth, height: imageHeight } = await image.metadata();
        console.log("  压在照片上的文字对比度：");
        for (const item of audit.heroTexts) {
          const left = Math.max(0, Math.min(Math.round(item.x), imageWidth - 1));
          const top = Math.max(0, Math.min(Math.round(item.y), imageHeight - 1));
          const width = Math.max(1, Math.min(Math.round(item.width), imageWidth - left));
          const height = Math.max(1, Math.min(Math.round(item.height), imageHeight - top));
          const stats = await image.clone().extract({ left, top, width, height }).stats();
          const photo = stats.channels.slice(0, 3).map(channel => channel.mean);
          const paint = parseColor(item.background);
          // 元素自己的背景（半透明或实心）叠在照片上，才是文字真正的底色
          const background = paint && paint.alpha > 0
            ? photo.map((value, index) => value * (1 - paint.alpha) + paint.rgb[index] * paint.alpha)
            : photo;
          let text = parseColor(item.color);
          if (text && item.inverted) text = { rgb: text.rgb.map(value => 255 - value), alpha: 1 };
          const ratio = text ? contrastRatio(relativeLuminance(text.rgb), relativeLuminance(background)) : null;
          // WCAG：≥24px 或 ≥18.66px 粗体算大字，门槛 3:1；其余 4.5:1
          const large = item.fontSize >= 24 || (item.fontSize >= 18.66 && Number(item.fontWeight) >= 700);
          const required = large ? 3 : 4.5;
          const verdict = ratio === null ? "?" : ratio >= required ? "达标" : ratio >= 3 ? "不足（只到大字门槛）" : "不达标";
          const shown = text ? `rgb(${text.rgb.map(value => Math.round(value)).join(",")})` : "?";
          console.log(`    ${ratio === null ? "?" : ratio.toFixed(2)}:1  需 ${required}:1  ${verdict}  ${item.fontSize}px/${item.fontWeight}  ${shown}  ${item.label}`);
        }
      }

      const blocking = [...new Set([...problems, ...violations.result.value])];
      if (blocking.length === 0) console.log("  控制台/CSP：无错误");
      else blocking.forEach(item => console.log(`  ⚠ ${item}`));
    }
  } finally {
    cleanup();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

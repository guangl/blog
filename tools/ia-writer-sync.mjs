#!/usr/bin/env node
/**
 * iA Writer 笔记 → Hexo 文章
 *
 * 在 iA Writer 里写好笔记，正文任意位置写一个 #blog 标记（或 front-matter 写
 * published: true），运行本脚本即可把这篇笔记变成 source/_posts 下的正式文章，
 * 顺带把引用的图片搬进文章资源目录。没打标记的笔记永远留在本地，不会被同步。
 *
 * 用法：
 *   node tools/ia-writer-sync.mjs --list       # 看看哪些笔记会被发布
 *   node tools/ia-writer-sync.mjs --dry-run    # 只打印计划，不写文件
 *   node tools/ia-writer-sync.mjs              # 真正同步，并跑一遍构建校验
 *   node tools/ia-writer-sync.mjs --no-verify  # 同步但不构建校验
 *   node tools/ia-writer-sync.mjs --prune      # 删除已取消 #blog 标记的旧文章
 *   node tools/ia-writer-sync.mjs --force      # 允许覆盖不是本工具生成的文章
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import sharp from 'sharp';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const POSTS_DIR = path.join(ROOT, 'source', '_posts');
const STATE_FILE = path.join(ROOT, 'source', '_data', 'caches', 'ia-writer-sync.json');
const CONFIG_FILE = path.join(ROOT, 'ia-writer.yml');
const TIME_ZONE = 'Asia/Shanghai';
const TZ_SUFFIX = '+08:00';
const NOW = Date.now();

const DEFAULTS = {
  libraries: [path.join(os.homedir(), 'Library/Mobile Documents/27N4MQEA55~pro~writer/Documents')],
  publish_tag: 'blog',
  default_category: '随记',
  default_ai_label: 'manual',
  slug_mode: 'pinyin',
  auto_cover: true,
  max_tags: 8,
};

const AI_LABELS = new Set(['manual', 'reviewed', 'polished', 'generated']);
const NOTE_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);

/* ---------------------------------------------------------------- 小工具 */

const c = {
  dim: s => '\u001b[2m' + s + '\u001b[0m',
  bold: s => '\u001b[1m' + s + '\u001b[0m',
  green: s => '\u001b[32m' + s + '\u001b[0m',
  yellow: s => '\u001b[33m' + s + '\u001b[0m',
  red: s => '\u001b[31m' + s + '\u001b[0m',
  cyan: s => '\u001b[36m' + s + '\u001b[0m',
};

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function parseArgs(argv) {
  const flags = {
    list: false, dryRun: false, prune: false, force: false,
    noVerify: false, fullVerify: false, library: [], only: null, help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--list': flags.list = true; break;
      case '--dry-run': case '-n': flags.dryRun = true; break;
      case '--prune': flags.prune = true; break;
      case '--force': flags.force = true; break;
      case '--no-verify': flags.noVerify = true; break;
      case '--full-verify': flags.fullVerify = true; break;
      case '--library': flags.library.push(argv[++i]); break;
      case '--only': flags.only = argv[++i]; break;
      case '--help': case '-h': flags.help = true; break;
      default:
        if (arg.startsWith('--library=')) flags.library.push(arg.slice(10));
        else if (arg.startsWith('--only=')) flags.only = arg.slice(7);
        else throw new Error('未知参数：' + arg);
    }
  }
  return flags;
}

function loadConfig(argv) {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_FILE)) {
    const parsed = yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8'), { schema: yaml.JSON_SCHEMA });
    if (parsed && typeof parsed === 'object') fileConfig = parsed;
  }
  const libraries = argv.library.length > 0
    ? argv.library
    : (fileConfig.libraries || DEFAULTS.libraries);
  return {
    ...DEFAULTS,
    ...fileConfig,
    libraries: (Array.isArray(libraries) ? libraries : [libraries]).map(expandHome),
  };
}

function walk(dir, found = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (NOTE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) found.push(full);
  }
  return found;
}

const wallFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

function toWall(ms) {
  const parts = Object.fromEntries(wallFormat.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    date: parts.year + '-' + parts.month + '-' + parts.day,
    clock: hour + ':' + parts.minute + ':' + parts.second,
  };
}

function formatStamp(ms) {
  const wall = toWall(ms);
  return wall.date + ' ' + wall.clock;
}

function parseWall(text) {
  const match = String(text).trim().match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!match) return null;
  const y = match[1];
  const mo = match[2].padStart(2, '0');
  const d = match[3].padStart(2, '0');
  const h = (match[4] || '00').padStart(2, '0');
  const mi = match[5] || '00';
  const s = match[6] || '00';
  const ms = Date.parse(y + '-' + mo + '-' + d + 'T' + h + ':' + mi + ':' + s + TZ_SUFFIX);
  return Number.isNaN(ms) ? null : ms;
}

function hash(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
}

/* ------------------------------------------------------------ 笔记解析 */

function splitFrontMatter(raw) {
  const text = raw.replace(/\r\n?/g, '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { data: {}, body: text, frontMatterError: false };
  try {
    const data = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) || {};
    return {
      data: typeof data === 'object' ? data : {},
      body: text.slice(match[0].length),
      frontMatterError: false,
    };
  } catch {
    return { data: {}, body: text, frontMatterError: true };
  }
}

const HASHTAG = /#([\p{L}\p{N}_-]+)/gu;

function isHashtagOnlyLine(line) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('#')) return false;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0) return false;
  return tokens.every(token => /^#[\p{L}\p{N}_-]+$/u.test(token));
}

function hashtagsIn(line) {
  const tags = [];
  for (const match of line.matchAll(HASHTAG)) {
    const tag = match[1];
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function asArray(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  return String(value).split(/[,，]/).map(s => s.trim()).filter(Boolean);
}

function firstHeading(body) {
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    const match = line.match(/^#\s+(.+?)\s*#*\s*$/);
    return match ? { title: match[1].trim(), line } : null;
  }
  return null;
}

function cleanFilenameTitle(file) {
  let name = path.basename(file, path.extname(file));
  name = name.replace(/-\d{4}-\d{2}-\d{2}(?:-\d{4})?$/, '');
  name = name.replace(/-[a-z0-9]{6}$/i, '');
  name = name.replace(/^\d{4}-\d{2}-\d{2}[-_ ]*/, '');
  return name.trim() || '未命名笔记';
}

function dateFromFilename(file) {
  const match = path.basename(file).match(/(\d{4})[-_](\d{2})[-_](\d{2})(?:[-_ T](\d{2})[-_:](\d{2}))?/);
  if (!match) return null;
  const clock = match[4] && match[5] ? ' ' + match[4] + ':' + match[5] : '';
  const ms = parseWall(match[1] + '-' + match[2] + '-' + match[3] + clock);
  return ms ? { ms, hasTime: Boolean(clock) } : null;
}

// 文件名只带日期（iA Writer 常见的 标题-2026-10-28-xxxxxx 形式）时，
// 直接用 00:00:00 会让同一天的多篇笔记排序混乱。日期部分保留文件名上的，
// 时分秒借用文件修改时间——那是作者实际写下这篇的时间。
function withClockFromMtime(dateMs, file) {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return dateMs;
  }
  return parseWall(toWall(dateMs).date + ' ' + toWall(mtimeMs).clock) || dateMs;
}

let pinyinFn = null;
try {
  const mod = await import('pinyin-pro');
  pinyinFn = mod.pinyin;
} catch {
  pinyinFn = null;
}

function slugify(title, mode) {
  const base = String(title).trim();
  if (mode === 'hash') return null;
  if (mode === 'title') {
    const kept = base.replace(/[\s/\\?%*:|"<>#]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return kept || null;
  }
  let latin = base;
  if (pinyinFn) {
    try {
      latin = pinyinFn(base, { toneType: 'none', type: 'string', nonZh: 'consecutive' });
    } catch {
      latin = base;
    }
  }
  const slug = latin
    .toLowerCase()
    .replace(/['’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (slug.length <= 60) return slug || null;
  const cut = slug.slice(0, 60);
  return cut.includes('-') ? cut.slice(0, cut.lastIndexOf('-')) : cut;
}

function stripInlineMarkdown(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\x60([^\x60]*)\x60/g, '$1')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
    .replace(/^\s*>\s?/, '')
    .trim();
}

function buildDescription(body) {
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(?:#{1,6}\s|!\[|\||\x60\x60\x60|---|[*+-]\s|\d+\.\s)/.test(trimmed)) continue;
    const plain = stripInlineMarkdown(trimmed);
    if (!plain) continue;
    return plain.length > 90 ? plain.slice(0, 90).trimEnd() + '…' : plain;
  }
  return '';
}

// 纯图片笔记没有正文可摘，用图片的 alt 文本兜底，避免 description 为空。
// 站点自检（tools/check-site.mjs）要求每页都有 meta description。
function imageAltSummary(body) {
  const alts = Array.from(new Set([...body.matchAll(/!\[([^\]]*)\]\([^)]*\)/g)]
    .map(match => match[1].replace(/\s+/g, ' ').trim())
    .filter(alt => alt.length > 1)));
  if (alts.length === 0) return '';
  const joined = alts.slice(0, 3).join('、');
  return joined.length > 90 ? joined.slice(0, 90).trimEnd() + '…' : joined;
}

/* ------------------------------------------------------------- 图片搬运 */

// 资源文件名统一成 <slug>-1.jpg、<slug>-2.jpg……：
// 相机/手机会给出 IMG_4821.HEIC、截屏 2026-10-28 下午4.32.11.png 这种名字，
// 中文、空格、括号都会在 URL 里被编码，排序也没法看。按出现顺序重新编号，
// 同一张图在正文里引用两次则共用一个名字。
// 浏览器只认 JPEG / PNG / WebP / AVIF / GIF：HEIC 只有 Safari 能显示，
// TIFF 一个都不认。这两种在同步时直接转成 JPEG，别把打不开的图搬到线上。
const CONVERT_TO_JPEG = new Set(['.heic', '.heif', '.tif', '.tiff']);

function assetExtension(source) {
  const ext = path.extname(source).toLowerCase();
  if (!ext) return { extension: '', convert: false };
  if (CONVERT_TO_JPEG.has(ext)) return { extension: '.jpg', convert: true };
  if (ext === '.jpeg' || ext === '.jpe') return { extension: '.jpg', convert: false };
  return { extension: ext, convert: false };
}

function extractAssets(body, noteDir, slug) {
  const assets = [];
  const bySource = new Map();
  const rewritten = body.replace(/(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (full, head, target, tail) => {
    if (/^(?:[a-z]+:)?\/\//i.test(target) || target.startsWith('data:') || target.startsWith('/')) return full;
    const decoded = decodeURIComponent(target.replace(/^\.\//, ''));
    const source = path.resolve(noteDir, decoded);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return full;
    let asset = bySource.get(source);
    if (!asset) {
      const target = assetExtension(source);
      asset = { source, name: slug + '-' + (assets.length + 1) + target.extension, convert: target.convert };
      assets.push(asset);
      bySource.set(source, asset);
    }
    return head + asset.name + tail;
  });
  return { body: rewritten, assets };
}

/* --------------------------------------------------------------- 状态 */

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.posts) return parsed;
  } catch {
    /* 首次运行或状态文件损坏都从空状态开始 */
  }
  return { version: 1, posts: {} };
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

/* --------------------------------------------------------- 单篇笔记转换 */

function planNote(file, config) {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = splitFrontMatter(raw);
  const data = parsed.data;
  const noteDir = path.dirname(file);
  const warnings = [];
  if (parsed.frontMatterError) warnings.push('front-matter 不是合法 YAML，已忽略');

  const fmTags = asArray(data.tags).concat(asArray(data.tag));
  const fmPublish = data.published === true || data.publish === true || data.draft === false;
  const bodyTags = [];
  let hasPublishTag = false;
  const kept = [];
  for (const line of parsed.body.split('\n')) {
    if (isHashtagOnlyLine(line)) {
      for (const tag of hashtagsIn(line)) {
        if (tag.toLowerCase() === config.publish_tag.toLowerCase()) hasPublishTag = true;
        else if (!bodyTags.includes(tag)) bodyTags.push(tag);
      }
      continue;
    }
    if (line.includes('#')) {
      kept.push(line.replace(/#([\p{L}\p{N}_-]+)/gu, (full, tag) => {
        if (tag.toLowerCase() !== config.publish_tag.toLowerCase()) return full;
        hasPublishTag = true;
        return '';
      }));
      continue;
    }
    kept.push(line);
  }

  const publish = fmPublish || hasPublishTag;
  let title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : null;
  const heading = firstHeading(kept.join('\n'));
  if (!title && heading) title = heading.title;
  if (!title) title = cleanFilenameTitle(file);

  let content = kept;
  if (heading && heading.title === title) {
    const index = content.findIndex(line => line.trim() === heading.line.trim());
    if (index >= 0) content = content.slice(index + 1);
  }
  while (content.length > 0 && !content[0].trim()) content.shift();
  while (content.length > 0 && !content[content.length - 1].trim()) content.pop();
  let body = content.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // 日期：front-matter > 文件名 > 文件修改时间
  let ms = null;
  if (data.date) {
    ms = data.date instanceof Date ? data.date.getTime() : parseWall(String(data.date));
    if (!ms) warnings.push('无法解析 date，改用文件时间');
  }
  if (!ms) {
    const fromFilename = dateFromFilename(file);
    if (fromFilename && !fromFilename.hasTime) ms = withClockFromMtime(fromFilename.ms, file);
    else if (fromFilename) ms = fromFilename.ms;
  }
  if (!ms) ms = fs.statSync(file).mtimeMs;
  const stamp = formatStamp(ms);
  if (ms > NOW) warnings.push('日期在未来（' + stamp + '），future: false 不会生成这篇');

  // slug
  const slugMode = typeof data.slug_mode === 'string' ? data.slug_mode : config.slug_mode;
  const explicitSlug = typeof data.slug === 'string' ? data.slug.trim() : '';
  let slug = explicitSlug
    ? explicitSlug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    : slugify(title, slugMode);
  if (!slug) {
    const wall = toWall(ms);
    slug = 'note-' + wall.date.replace(/-/g, '') + '-' + wall.clock.slice(0, 2) + wall.clock.slice(3, 5)
      + '-' + hash(file);
  }

  // 资源要在 slug 定了之后再编号：文件名是 <slug>-1.jpg，改标题/改 slug 时一起跟着变
  const assets = extractAssets(body, noteDir, slug);
  body = assets.body;

  const tags = Array.from(new Set([...fmTags, ...bodyTags])).slice(0, config.max_tags);
  const categories = asArray(data.categories == null ? data.category : data.categories);
  const aiLabelRaw = typeof data.ai_label === 'string' ? data.ai_label.trim() : '';
  const aiLabel = AI_LABELS.has(aiLabelRaw) ? aiLabelRaw : config.default_ai_label;

  // updated 取笔记自己的最后修改时间：改过笔记就刷新，没改就保持原样。
  // 笔记的 date 由文件名/正文决定，不能拿它冒充「最后更新」。
  let updatedMs = ms;
  try {
    const mtimeMs = fs.statSync(file).mtimeMs;
    if (mtimeMs > updatedMs) updatedMs = mtimeMs;
  } catch {
    // 取不到就沿用 date
  }

  const wall = toWall(ms);
  const permalinkDir = wall.date.replace(/-/g, '/') + '/' + slug;
  const explicitCover = typeof data.cover === 'string' && data.cover.trim() ? data.cover.trim() : '';
  const cover = explicitCover
    || (config.auto_cover && assets.assets.length > 0 ? '/' + permalinkDir + '/' + assets.assets[0].name : '');

  return {
    file, noteDir, publish, hasPublishTag, fmPublish, warnings,
    title, slug, stamp, ms, updatedMs, tags,
    categories: categories.length > 0 ? categories : [config.default_category],
    description: typeof data.description === 'string' && data.description.trim()
      ? data.description.trim().replace(/\s+/g, ' ')
      : (buildDescription(body) || imageAltSummary(body) || title),
    cover, aiLabel, body, assets: assets.assets, permalinkDir,
  };
}

function quoteYaml(value) {
  const text = String(value);
  if (/^[\w\u4e00-\u9fa5][^:#\n]*$/.test(text) && !/^(?:true|false|null|on|off|yes|no)$/i.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

function yamlList(key, values) {
  const head = key + ':';
  const items = values.map(value => '  - ' + value);
  return head + '\n' + items.join('\n');
}

function renderPost(plan, fixedDate) {
  const lines = ['---'];
  lines.push('title: ' + quoteYaml(plan.title));
  lines.push('date: ' + (fixedDate || plan.stamp));
  lines.push('updated: ' + formatStamp(plan.updatedMs));
  lines.push(yamlList('categories', plan.categories));
  if (plan.tags.length > 0) lines.push(yamlList('tags', plan.tags));
  lines.push('description: ' + quoteYaml(plan.description));
  if (plan.cover) lines.push('cover: ' + plan.cover);
  lines.push('article:');
  lines.push('  ai_label: ' + plan.aiLabel);
  lines.push('---');
  return lines.join('\n') + '\n\n' + plan.body + '\n';
}

/* --------------------------------------------------- HEIC / TIFF → JPEG */

// 长边封顶 3840：和 tools/optimize-images.mjs 的重压阈值一致，
// 手机原图 4032 宽转成 JPEG 会有好几 MB，进 Git 太重。
const CONVERT_MAX_EDGE = 3840;

function sipsToJpeg(source, dest) {
  const result = spawnSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', source, '--out', dest], { stdio: 'pipe' });
  return result.status === 0 && fs.existsSync(dest);
}

// 两条路都走 sharp 收尾：sharp 写 JPEG 默认不带元数据（EXIF 里的 GPS 不进仓库），
// .rotate() 按 EXIF 的拍摄方向摆正——手机竖拍的照片宽高是反的，不摆正会躺倒。
//
// 直接给 sharp 读：TIFF 可以，HEIC 不行（sharp 的预编译库只有 AVIF 的 HEVC 解码，
// HEVC-in-HEIF 读不了，会报 bad seek / heif: Error while decoding）。所以 HEIC/HEIF
// 先交给 macOS 自带的 sips——它走系统解码器，iPhone 的 10-bit HEIC 也没问题。
async function writeConvertedAsset(asset, dest) {
  const encode = input => sharp(input)
    .rotate()
    .resize({ width: CONVERT_MAX_EDGE, height: CONVERT_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true, progressive: true });

  // JPEG 没有透明通道，透明区域会被压成黑底。照片本来就没有 alpha，
  // 但截图/抠图导出成 TIFF 会带——那种图该存 PNG，提示一下别让它悄悄变黑。
  let alpha = false;
  try {
    alpha = Boolean((await sharp(asset.source).metadata()).hasAlpha);
  } catch { /* 读不出元数据就先不管，反正后面还有一条路 */ }

  try {
    await encode(asset.source).toFile(dest);
    return { ok: true, alpha };
  } catch {
    const temp = dest + '.sips.jpg';
    try {
      if (!sipsToJpeg(asset.source, temp)) return { ok: false, alpha: false };
      await encode(temp).toFile(dest);
      return { ok: true, alpha };
    } catch {
      return { ok: false, alpha: false };
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
}

/* ------------------------------------------------------------- 写文件 */

async function writePlan(plan, state, flags, report) {
  const postFile = path.join(POSTS_DIR, plan.slug + '.md');
  const assetDir = path.join(POSTS_DIR, plan.slug);
  const entry = state.posts[plan.slug];
  // 改了标题或 slug：同一篇笔记换了目标文件名。挪走旧文章（含资源目录），
  // 而不是在 source/_posts/ 里留一份没人认领的孤儿。
  const previousSlug = Object.keys(state.posts)
    .find(key => key !== plan.slug && state.posts[key].notePath === plan.file);
  const previous = previousSlug ? state.posts[previousSlug] : null;
  const exists = fs.existsSync(postFile);

  if (entry && entry.notePath !== plan.file) {
    report.problem('slug「' + plan.slug + '」已被另一篇笔记占用：' + entry.notePath);
    return false;
  }
  if (exists && !entry && !flags.force) {
    report.problem('source/_posts/' + plan.slug + '.md 已存在且不是本工具生成的，加 --force 才覆盖');
    return false;
  }

  const action = previous ? 'rename' : exists ? 'update' : 'create';
  if (flags.dryRun) {
    report.plan(plan, action);
    return false;
  }

  if (previous) {
    const oldPost = path.join(POSTS_DIR, previousSlug + '.md');
    const oldAssets = path.join(POSTS_DIR, previousSlug);
    if (fs.existsSync(oldPost)) fs.rmSync(oldPost, { force: true });
    if (oldAssets !== assetDir && fs.existsSync(oldAssets)) fs.rmSync(oldAssets, { recursive: true, force: true });
    delete state.posts[previousSlug];
  }

  fs.mkdirSync(POSTS_DIR, { recursive: true });
  if (plan.assets.length > 0) {
    fs.mkdirSync(assetDir, { recursive: true });
    for (const asset of plan.assets) {
      const dest = path.join(assetDir, asset.name);
      if (!asset.convert) {
        fs.copyFileSync(asset.source, dest);
        continue;
      }
      const result = await writeConvertedAsset(asset, dest);
      if (!result.ok) {
        report.problem(plan.title + '：' + path.basename(asset.source) + ' 转不成 JPEG，先导出成 JPEG 再同步');
        return false;
      }
      if (result.alpha) {
        report.problem(plan.title + '：' + path.basename(asset.source) + ' 带透明通道，转成 JPEG 后透明区域会变黑，这张建议改存 PNG');
      }
    }
  }
  if (entry && Array.isArray(entry.assets)) {
    for (const old of entry.assets) {
      if (!plan.assets.some(asset => asset.name === old)) {
        const stale = path.join(assetDir, old);
        if (fs.existsSync(stale)) fs.rmSync(stale, { force: true });
      }
    }
  }

  fs.writeFileSync(postFile, renderPost(plan, (entry && entry.date) || (previous && previous.date)));
  state.posts[plan.slug] = {
    notePath: plan.file,
    noteHash: hash(plan.body + JSON.stringify(plan.assets.map(asset => asset.name))),
    date: (entry && entry.date) || (previous && previous.date) || plan.stamp,
    assets: plan.assets.map(asset => asset.name),
    syncedAt: formatStamp(NOW),
  };
  report.written(plan, action);
  return true;
}

/* --------------------------------------------------------------- 校验 */

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
  return result.status === 0;
}

function verify(flags) {
  console.log('\n' + c.bold('构建校验'));
  if (flags.fullVerify) return run('bun', ['run', 'verify']);
  if (!run('bunx', ['hexo', 'generate'])) return false;
  return run('node', ['tools/check-site.mjs']);
}

/* --------------------------------------------------------------- 主流程 */

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    const source = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const header = source.slice(0, source.indexOf('*/') + 2);
    console.log(header.replace(/^\/\*\*?/, '').replace(/^\s*\* ?/gm, ''));
    return 0;
  }
  const config = loadConfig(flags);

  const libraries = config.libraries.filter(dir => fs.existsSync(dir));
  for (const missing of config.libraries.filter(dir => !fs.existsSync(dir))) {
    console.log(c.yellow('跳过不存在的库：') + missing);
  }
  if (libraries.length === 0) {
    console.error(c.red('没有可用的 iA Writer 库目录，请检查 ia-writer.yml 的 libraries'));
    return 1;
  }

  const files = libraries.flatMap(dir => walk(dir)).sort();
  const plans = files.map(file => planNote(file, config)).filter(plan => {
    if (!flags.only) return true;
    return plan.file.toLowerCase().includes(flags.only.toLowerCase());
  });
  const publishable = plans.filter(plan => plan.publish);
  const privateCount = plans.length - publishable.length;

  console.log(c.bold('iA Writer → 博客'));
  for (const dir of libraries) console.log(c.dim('  库 ') + dir);
  console.log(c.dim('  扫描到 ' + plans.length + ' 篇笔记'));

  if (flags.list) {
    console.log('');
    for (const plan of plans) {
      const flag = plan.publish ? c.green('发布') : c.dim('私有');
      const why = plan.publish
        ? (plan.fmPublish ? 'front-matter' : '#' + config.publish_tag)
        : '无 #' + config.publish_tag;
      console.log('  ' + flag + '  ' + plan.title + c.dim('  (' + why + ')  ' + plan.file));
    }
    console.log('');
    console.log(c.dim('共 ' + publishable.length + ' 篇可发布，' + privateCount + ' 篇保持私有。'));
    console.log(c.dim('实际写入：bun run notes:sync'));
    return 0;
  }

  const report = {
    rows: [],
    problems: [],
    writtenCount: 0,
    plan(plan, action) { this.rows.push({ plan, action }); },
    written(plan, action) { this.rows.push({ plan, action }); this.writtenCount += 1; },
    problem(message) { this.problems.push(message); },
  };

  const state = loadState();
  for (const plan of publishable) await writePlan(plan, state, flags, report);
  for (const plan of plans) {
    for (const warning of plan.warnings) report.problem(plan.title + '：' + warning);
  }

  const stale = Object.keys(state.posts).filter(slug => !publishable.some(plan => plan.slug === slug));

  console.log('');
  if (publishable.length === 0) {
    console.log(c.dim('  没有打了 #' + config.publish_tag + ' 标记的笔记，不写任何文件。'));
  }
  for (const row of report.rows) {
    const label = row.action === 'update'
      ? c.cyan('更新')
      : row.action === 'rename' ? c.yellow('改名') : c.green('新建');
    const extras = [];
    if (row.plan.tags.length > 0) extras.push('标签 ' + row.plan.tags.join(' / '));
    if (row.plan.assets.length > 0) extras.push(row.plan.assets.length + ' 张图');
    const converted = row.plan.assets.filter(asset => asset.convert).length;
    if (converted > 0) extras.push(converted + ' 张 HEIC/TIFF 转成 JPEG');
    console.log('  ' + label + '  ' + row.plan.title + c.dim('  → source/_posts/' + row.plan.slug + '.md'));
    if (extras.length > 0) console.log(c.dim('        ' + extras.join('，')));
  }
  for (const problem of report.problems) console.log('  ' + c.yellow('注意') + '  ' + problem);

  if (flags.prune && !flags.dryRun) {
    for (const slug of stale) {
      const postFile = path.join(POSTS_DIR, slug + '.md');
      const assetDir = path.join(POSTS_DIR, slug);
      if (fs.existsSync(postFile)) fs.rmSync(postFile, { force: true });
      if (fs.existsSync(assetDir)) fs.rmSync(assetDir, { recursive: true, force: true });
      delete state.posts[slug];
      console.log('  ' + c.red('删除') + '  source/_posts/' + slug + '.md（笔记已取消发布标记）');
    }
  } else if (stale.length > 0) {
    console.log(c.dim('  ' + stale.length + ' 篇已同步文章对应的笔记取消了发布标记，加 --prune 可删除。'));
  }

  if (flags.dryRun) {
    console.log('');
    console.log(c.dim('--dry-run：没有写入任何文件。'));
    return 0;
  }

  saveState(state);
  console.log('');
  console.log(c.dim('同步完成：写入 ' + report.writtenCount + ' 篇，' + privateCount + ' 篇笔记保持私有。'));

  if (report.writtenCount > 0 && !flags.noVerify) {
    if (!verify(flags)) {
      console.error(c.red('构建校验失败：文章已写入，按上面的报错修好再提交。'));
      return 1;
    }
    console.log(c.green('构建校验通过。'));
  }
  return 0;
}

process.exitCode = await main();

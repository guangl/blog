#!/usr/bin/env node
/**
 * 压小文章里的「原图」（手动运行，会改 `source/`）
 *
 * 构建期的 `scripts/image-pipeline.js` 只生成变体、不动原图；但文章里那张
 * 「点击查看大图」用的原图本身也可能是相机直出，几 MB 起步。这个脚本把过大的
 * 原图按下面的规则原地重压：
 *
 *   - 长边超过 `MAX_WIDTH`（默认 3840，约 4K）时缩到该尺寸；
 *   - 大小超过 `MIN_SIZE_MB`（默认 1.5MB）时用 mozjpeg q90 渐进式重压；
 *   - PNG 不做有损转换，只报告（照片站很少用 PNG）。
 *
 * 默认只报告不写入，确认后再加 `--write`：
 *
 *   bun run images:report     # 只看会改哪些、能省多少
 *   bun run images:compress   # 真正写入（可用 git 回退）
 *
 * ⚠️ 重压会改变原图字节。文章里如果写着「查看原图」，含义就变成了「查看大图」——
 * 真正未压缩的原始文件在 git 历史里还能找到（`git log --follow -- <文件>`）。
 */

"use strict";

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const MAX_WIDTH = 3840;
const MIN_SIZE_MB = 1.5;
const JPEG_QUALITY = 90;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const postsDir = join(root, "source/_posts");
const write = process.argv.includes("--write");

function imageFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return imageFiles(path);
    return /\.(jpe?g|png)$/i.test(entry.name) ? [path] : [];
  });
}

const mb = bytes => `${(bytes / 1024 / 1024).toFixed(2)}MB`;

const targets = imageFiles(postsDir);
let saved = 0;
let changed = 0;

for (const file of targets) {
  const before = statSync(file).size;
  const meta = await sharp(file).metadata();
  const tooWide = meta.width > MAX_WIDTH;
  const tooHeavy = before / 1024 / 1024 > MIN_SIZE_MB;
  const label = file.replace(`${root}/`, "");

  if (!tooWide && !tooHeavy) {
    console.log(`跳过  ${label}  ${meta.width}×${meta.height}  ${mb(before)}`);
    continue;
  }
  if (extname(file).toLowerCase() === ".png") {
    console.log(`跳过  ${label}  ${meta.width}×${meta.height}  ${mb(before)}（PNG 不做有损转换，需要时手动处理）`);
    continue;
  }

  const encoded = await sharp(file)
    .resize(tooWide ? MAX_WIDTH : meta.width, null, { withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, progressive: true })
    .toBuffer();

  // 重压后反而更大就别写
  if (encoded.length >= before) {
    console.log(`跳过  ${label}  ${mb(before)}（重压后 ${mb(encoded.length)}，不划算）`);
    continue;
  }

  const newMeta = await sharp(encoded).metadata();
  console.log(`${write ? "重压" : "待压"}  ${label}  ${meta.width}×${meta.height} ${mb(before)}`
    + ` → ${newMeta.width}×${newMeta.height} ${mb(encoded.length)}`
    + `（省 ${(100 - encoded.length / before * 100).toFixed(0)}%）`);
  saved += before - encoded.length;
  changed += 1;
  if (write) writeFileSync(file, encoded);
}

console.log(`\n${targets.length} 张图，${changed} 张${write ? "已重压" : "待重压"}，共省 ${mb(saved)}`);
if (!write && changed > 0) console.log("加 --write 生效：bun run images:compress");

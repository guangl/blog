#!/usr/bin/env node
/**
 * 从 `source/images/favicon.svg` 生成 `source/favicon.ico` 与 `source/apple-touch-icon.png`。
 *
 * 为什么需要 .ico：主题只在 head 里输出 `<link rel="shortcut icon" href="/images/favicon.svg">`。
 * 现代浏览器认这条，但不少 RSS 阅读器、旧浏览器、第三方工具仍然会直接请求根目录的
 * `/favicon.ico`，拿不到就是 404。根目录必须有这个文件。
 *
 * 为什么不用第三方包：sharp 已经是主题的依赖（`hexo-theme-stellar` 依赖 sharp 0.34），
 * 这里直接用它栅格化 SVG、编码 PNG；ICO 容器格式很简单，手写 22 字节头就够了
 * （Vista 以后允许 ICO 里直接内嵌 PNG 数据）。
 *
 * 用法：`bun run favicon`（改过 favicon.svg 之后重新跑一次，产物提交进仓库）。
 */

"use strict";

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_SVG = resolve(root, "source/images/favicon.svg");
const ICO_PATH = resolve(root, "source/favicon.ico");
const APPLE_PATH = resolve(root, "source/apple-touch-icon.png");

// ICO 里放三个尺寸：浏览器标签页 16、任务栏 / 书签 32、桌面快捷方式 48
const ICO_SIZES = [16, 32, 48];
const APPLE_SIZE = 180;
// 与 favicon.svg 里的圆角底色一致；iOS 会自己加圆角遮罩，这里必须不留透明像素
const BRAND_BACKGROUND = "#173c3a";

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 宽（0 表示 256）
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // 高
    entry.writeUInt8(0, 2); // 调色板数
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // 色彩平面
    entry.writeUInt16LE(32, 6); // 位深
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map(image => image.data)]);
}

const svg = readFileSync(SOURCE_SVG);

// 每个尺寸都用 SVG 矢量源重新栅格化，比放大 16px 的小图清楚
const pngs = await Promise.all(
  ICO_SIZES.map(async size => ({
    size,
    data: await sharp(svg, { density: Math.max(72, size * 6) })
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer()
  }))
);

writeFileSync(ICO_PATH, encodeIco(pngs));

writeFileSync(APPLE_PATH, await sharp(svg, { density: 72 * 6 })
  .resize(APPLE_SIZE, APPLE_SIZE)
  .flatten({ background: BRAND_BACKGROUND })
  .png({ compressionLevel: 9 })
  .toBuffer());

const sizeOf = path => `${(readFileSync(path).length / 1024).toFixed(1)}KB`;
console.log(`favicon.ico  ${ICO_SIZES.join("/")}px  ${sizeOf(ICO_PATH)}`);
console.log(`apple-touch-icon.png  ${APPLE_SIZE}px  ${sizeOf(APPLE_PATH)}`);

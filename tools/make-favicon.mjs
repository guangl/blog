#!/usr/bin/env node
/**
 * 以 `source/images/avatar.png` 为唯一源图，生成同目录的 avatar.svg / favicon.svg、
 * `source/favicon.ico` 与 `source/apple-touch-icon.png`。
 * SVG 内嵌原始 PNG 字节，是自包含的位图包装，不是重新绘制的矢量图。
 *
 * 为什么需要 .ico：主题只在 head 里输出 `<link rel="shortcut icon" href="/images/favicon.svg">`。
 * 现代浏览器认这条，但不少 RSS 阅读器、旧浏览器、第三方工具仍然会直接请求根目录的
 * `/favicon.ico`，拿不到就是 404。根目录必须有这个文件。
 *
 * 为什么不新增依赖：仓库已经直接依赖 sharp，
 * 这里直接用它缩放源图、编码 PNG；ICO 容器由目录头、各尺寸条目与图片数据组成
 * （Vista 以后允许 ICO 里直接内嵌 PNG 数据）。
 *
 * 用法：更换 avatar.png 后运行 `bun run favicon`，源图与四个产物一起提交。
 * 不要手工修改生成文件，否则头像、标签页和 Apple 书签图标会再次分叉。
 */

"use strict";

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PNG = resolve(root, "source/images/avatar.png");
const SVG_PATHS = ["avatar.svg", "favicon.svg"].map(name => resolve(root, "source/images", name));
const ICO_PATH = resolve(root, "source/favicon.ico");
const APPLE_PATH = resolve(root, "source/apple-touch-icon.png");

// ICO 里放三个尺寸：浏览器标签页 16、任务栏 / 书签 32、桌面快捷方式 48
const ICO_SIZES = [16, 32, 48];
const APPLE_SIZE = 180;
// 保持源头像的白底；iOS 会自己加圆角遮罩，这里不留透明像素
const BRAND_BACKGROUND = "#ffffff";

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

const source = readFileSync(SOURCE_PNG);
const { format, width, height } = await sharp(source).metadata();
if (format !== "png" || !width || !height) {
  throw new Error("source/images/avatar.png 必须是具有有效尺寸的 PNG 图片");
}

// 两个 SVG 使用完全相同的源图字节，不依赖 favicon 环境可能禁止加载的外部图片。
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="罗广">
  <!-- Generated from avatar.png by bun run favicon; raster-backed SVG. -->
  <image width="${width}" height="${height}" href="data:image/png;base64,${source.toString("base64")}"/>
</svg>
`;

// 每个尺寸都从原始 PNG 独立缩放，避免从小尺寸图标反复放大。
const pngs = await Promise.all(
  ICO_SIZES.map(async size => ({
    size,
    data: await sharp(source)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .png({ compressionLevel: 9 })
      .toBuffer()
  }))
);

const apple = await sharp(source)
  .resize(APPLE_SIZE, APPLE_SIZE, { fit: "contain", background: BRAND_BACKGROUND })
  .flatten({ background: BRAND_BACKGROUND })
  .png({ compressionLevel: 9 })
  .toBuffer();

// 全部编码成功后再写入，避免输入无效时留下部分更新的图标。
for (const path of SVG_PATHS) writeFileSync(path, svg);
writeFileSync(ICO_PATH, encodeIco(pngs));
writeFileSync(APPLE_PATH, apple);

const sizeOf = path => `${(readFileSync(path).length / 1024).toFixed(1)}KB`;
console.log(`avatar.svg / favicon.svg  ${width}×${height}px PNG 内嵌  ${sizeOf(SVG_PATHS[0])} each`);
console.log(`favicon.ico  ${ICO_SIZES.join("/")}px  ${sizeOf(ICO_PATH)}`);
console.log(`apple-touch-icon.png  ${APPLE_SIZE}px  ${sizeOf(APPLE_PATH)}`);

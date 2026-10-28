# 从 iA Writer 同步笔记

手机上用 iA Writer 写的东西，靠一条命令变成博客文章。工具是 [`tools/ia-writer-sync.mjs`](../tools/ia-writer-sync.mjs)，配置在 [`ia-writer.yml`](../ia-writer.yml)。

默认只读取 iCloud 里的 iA Writer 库：

```
~/Library/Mobile Documents/27N4MQEA55~pro~writer/Documents
```

## 日常流程

1. 在 iA Writer 里照常写笔记，想发布时在正文里写一行 **`#blog`**（写在哪都行，同步时会从正文里删掉）。
2. 回到仓库跑：

```bash
bun run notes:list    # 看看哪些笔记会发、会写成什么 slug，不写文件
bun run notes:sync    # 真的写文章，然后自动构建 + 自检
```

3. 检查 `git status` / 本地预览，觉得可以就自己 commit、部署。**工具不会 commit、不会部署。**

没有 `#blog` 的笔记永远只留在 iA Writer 里。私人笔记（作息、清单、草稿）不要加这个标记就绝对安全。

## 笔记可以写成什么样

最省事的写法就是纯 Markdown：

```markdown
# 清晨的江滩

#blog

今天五点半起床，江滩上只有几个跑者。

![江边的日出](shot.jpg)

#跑步 #武汉
```

同步结果：

- 标题 = 第一个 H1（H1 会从正文里移除）；没有 H1 就用文件名；
- `#blog` 被删掉，不留在正文里；
- 末尾那行 `#跑步 #武汉` 变成 front-matter 的 tags，同样从正文里删掉；
- 同目录的 `shot.jpg` 复制进 `source/_posts/<slug>/`，并改名成 `<slug>-1.jpg`；
- 没写 description 就用正文第一段（去 Markdown，截 90 字）；
- 没写日期就用文件名里的日期，文件名没有日期就用文件修改时间。

想精确控制就用 front-matter（iA Writer 里也可以写在文件开头）：

```yaml
---
title: 手动标题不如干净
date: 2026-10-26 21:30
slug: manual-slug-test
categories: [摄影]
tags: [月亮, 长曝光]
description: 手写的描述会优先使用。
cover: /images/cover.jpg
ai_label: reviewed
---
正文……
```

只认这些键：`title`、`date`、`updated`、`slug`、`categories`（或 `category`）、`tags`（或 `tag`）、`description`、`cover`、`ai_label`，以及发布开关 `published` / `publish` / `draft`。别的键会被忽略——Stellar 2.0 的 front-matter schema 是封闭的，写进去的未知字段只会在每次构建时变成一行警告。

## 生成的文章长什么样

- 路径 `source/_posts/<slug>.md`，`slug` 默认是中文标题转拼音（`slug_mode: pinyin`，可改 `title` / `hash`）；
- front-matter 只写 Stellar 认识的键：`title`、`date`、`updated`、`categories`、`tags`、`description`、`cover`、`article.ai_label`；
- 图片放 `source/_posts/<slug>/`，文件名统一成 `<slug>-1.jpg`、`<slug>-2.png`……按出现顺序编号：相机的 `IMG_4821.HEIC`、手机的「截屏 2026-10-28 下午4.32.11.png」这类名字带空格和中文，进 URL 要编码、排序也没法看。`.jpeg` 统一成 `.jpg`，同一张图引用两次共用一个名字，子目录里的图会被拉平（不会丢，靠编号区分）；
- 正文里的引用会跟着改名，后续由 `scripts/image-pipeline.js` 生成多种尺寸；
- `.heic` / `.heif` / `.tif` / `.tiff` 同步时**直接转成 JPEG**，不会把打不开的图搬到线上：HEIC 只有 Safari 认、TIFF 一个浏览器都不认。TIFF 用 sharp 读；HEIC/HEIF 的 HEVC sharp 解不了（预编译库只带 AVIF），退回 macOS 自带的 `sips`（系统解码器，iPhone 的 10-bit HEIC 也能读），再用 sharp 收尾：长边封顶 3840、按 EXIF 方向摆正、**不保留任何元数据**（EXIF 里的 GPS 不进 Git）。转换失败时会提示先在 iA Writer 里导出成 JPEG——那种情况通常是没有 `sips` 的非 macOS 环境；
- 为什么落到 JPEG 而不是更小的 AVIF/WebP：`scripts/image-pipeline.js` 只接管 `.jpg` / `.png` 主图，AVIF/WebP/多尺寸变体都是它构建时按档生成的（产物、不进仓库）。直接存 AVIF 当主图，构建就认不出来，既没有 `srcset` 也没有兜底。JPEG 编码参数和 `tools/optimize-images.mjs` 的重压保持一致（q90 mozjpeg 渐进式、长边 3840）。截图、线稿、带透明通道的图本该是 PNG；带 alpha 的 TIFF 被转成 JPEG 时透明会变黑，工具会打一行「注意」提示改存 PNG；
- 正文第一张图自动当 `cover`（`auto_cover: true`），没有图就不写 cover，主题会用兜底图。

## 状态文件与幂等

同步记录存在 `source/_data/caches/ia-writer-sync.json`（已在 `.gitignore` 里），记的是「哪个 slug 来自哪个笔记、日期是多少、复制了哪些图」。

- 再跑一次不会重复创建，只会更新内容，且**保留第一次的 date**，避免重跑把旧文章标成刚发布；
- 没有记录、但 `source/_posts/` 里已有同名文件时，工具会拒绝覆盖并提示——手写的文章不会被笔记顶掉。确实要覆盖加 `--force`；
- 笔记里删掉 `#blog` 后，已生成的文章**默认保留**（可能已经在线上被引用）；要删加 `--prune`；
- 改了笔记标题（或 `slug`）会让 slug 变，工具会把旧文章和旧资源目录一起挪走，date 保持不变，输出里标成「改名」。

## 命令

```bash
bun run notes:list                     # 列出可发布 / 私有的笔记
bun run notes:dry                      # 详细预演，不写文件
bun run notes:sync                     # 同步 + 构建 + 自检
node tools/ia-writer-sync.mjs --help   # 全部参数
```

常用参数：

| 参数 | 作用 |
| --- | --- |
| `--library <path>` | 换一个库目录（可重复，用于测试） |
| `--only <substr>` | 只处理路径里含该片段的笔记 |
| `--force` | 覆盖同名但非本工具生成的文章 |
| `--prune` | 删掉已经取消 `#blog` 的文章 |
| `--no-verify` | 只写文件，不跑构建自检 |
| `--full-verify` | 写完跑完整 `hexo stellar doctor` + 干净构建 |

## 排错

- **同步了但网页上没有**：站点 `future: false`，日期在未来就不会生成。工具会给出「日期在未来」的提示，改 `date` 即可。
- **中文 slug 变成一串拼音很长**：在笔记里写 `slug: my-own-slug` 单篇指定；或全局把 `slug_mode` 改成 `hash`。
- **重跑后日期变了**：不会。date 存在状态文件里；只有删掉状态文件才会重新按文件名/修改时间算。
- **自检报「Article missing from the image sitemap」**：那是纯文字文章声明了主题的兜底社交图（`_config.stellar.yml` 的 `fallbacks.cover`）导致的误报，`tools/check-site.mjs` 已把兜底图排除在「文章配图」之外。

## 为什么不做成自动发布

同步只写 `source/_posts/`，不 commit、不 push、不 deploy。发布仍然走原来的 `bun run deploy` 流程：手机上写完只是「存进仓库」，什么时候上线由人决定。

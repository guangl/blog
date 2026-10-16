/* global hexo */
/**
 * 公式插件（构建期）
 *
 * 为什么需要它：站点用 hexo-renderer-marked（marked 15），Markdown 阶段会破坏 LaTeX。
 * 实测两个具体问题：
 *   1. `\,` `\;` `\:` `\!` 是 CommonMark 定义的可转义标点，会被吃掉 ——
 *      `$a_0\,x$` 变成 `$a_0,x$`，公式语义就错了。
 *   2. `$$` 块会被拆行、`\[ \]` 的反斜杠也会被吃掉。
 * 而 `\int` `\infty` `\frac` 这类「反斜杠 + 字母」是安全的，`$` 本身也安全。
 *
 * 做法：
 *   - before_post_render：把 $$...$$ 抽成块级占位标记（避免被拆行），并把公式里的
 *     \, \; \: \! 换成数学模式等价写法 \mkern{3,5,4,-3}mu。间距语义相同，
 *     但不含「反斜杠 + 标点」，marked 不会碰；行内公式保留 $...$，段落不被拆开。
 *   - after_post_render：把占位标记还原成 $$...$$，交给 MathJax。
 *     这一步早于搜索索引与 RSS 生成，所以索引里是干净的 LaTeX 纯文本。
 *
 * 渲染由本插件注入的 MathJax 加载器完成（见文件末尾）。注意 features.math.provider
 * 需保持 null：主题自带的客户端扩展只认 <script type="math/tex">（MathJax 2 的约定），
 * 在 MathJax 3 下不会排版；本插件改为直接输出 MathJax 3 的 $...$/$$...$$ 定界符。
 *
 * 只处理正文；围栏代码块与行内代码里的 $ 原样保留。
 */

"use strict";

// $$...$$ 的块级占位标记（不含 $ 与反斜杠，安全穿过 marked）
const DISPLAY_OPEN = "@@STELLARMATHOPEN@@";
const DISPLAY_CLOSE = "@@STELLARMATHCLOSE@@";

// CommonMark 可转义标点 → 等价的数学模式间距命令（\mkern 是 TeX 原始命令，MathJax 核心支持）
const SPACING_EQUIV = {
  ",": "\\mkern3mu",
  ";": "\\mkern5mu",
  ":": "\\mkern4mu",
  "!": "\\mkern-3mu",
};

function guardEscapablePunctuation(tex) {
  return tex.replace(/\\([,;:!])/g, (match, char) => SPACING_EQUIV[char] || match);
}

// 按围栏代码块与行内代码切开，只处理 code === false 的片段。
function splitSegments(content) {
  const segments = [];
  const fence = /(^|\n)( {0,3})(```|~~~)[^\n]*\n[\s\S]*?(?:\n\2\3[ \t]*(?=\n|$)|$)/g;
  let last = 0;
  let match;
  while ((match = fence.exec(content)) !== null) {
    if (match.index > last) segments.push({ code: false, text: content.slice(last, match.index) });
    segments.push({ code: true, text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < content.length) segments.push({ code: false, text: content.slice(last) });

  return segments.flatMap(segment => {
    if (segment.code) return [segment];
    return segment.text
      .split(/(`+[^`]*?`+)/g)
      .filter(part => part !== "")
      .map(text => ({ code: text.startsWith("`"), text }));
  });
}

function protectMath(content) {
  return splitSegments(content).map(segment => {
    if (segment.code) return segment.text;
    let text = segment.text;

    // 行间公式 $$...$$ → 占位标记，避免 marked 拆行
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, (raw, tex) => {
      const body = guardEscapablePunctuation(tex.trim());
      if (body.length === 0) return raw;
      return `${DISPLAY_OPEN}${body}${DISPLAY_CLOSE}`;
    });

    // 行内公式 $...$，排除被转义的 \$ 与空内容
    text = text.replace(/(?<!\\)\$([^\n$]+?)(?<!\\)\$/g, (raw, tex) => {
      const body = guardEscapablePunctuation(tex.trim());
      if (body.length === 0) return raw;
      return `$${body}$`;
    });

    return text;
  }).join("");
}

function restoreDisplayMath(html) {
  return html.replace(
    new RegExp(`${DISPLAY_OPEN}([\\s\\S]*?)${DISPLAY_CLOSE}`, "g"),
    (raw, tex) => `$$${tex}$$`
  );
}

// MathJax 3 配置：$...$ 行内、$$...$$ 行间；跳过 code/pre，避免误排代码里的 $。
// 补排的原因：MathJax 默认在 DOMContentLoaded 自动排版，而 Stellar 运行时的客户端
// 渲染发生在这之前，行内公式会被漏掉（行间的 $$ 块能被后续处理捡回，行内不能）。
// 因此在页面 load 后再排一次，保证两类公式都覆盖。
// MathJax 3 配置：显式声明 $...$ 行内定界符（$$...$$ 与 \[...\] 是默认支持的）。
//
// 注意这里必须保持「单行 + 双引号 + 转义 $」的写法：早期版本写成多行并在单引号
// 数组字面量里直接写 '$'，会让生成的 HTML 结构损坏（整页外壳重复三次、出现 EJS
// 残留）。原因未完全查清，判断与该字符串在主题渲染管线中的序列化有关。
// 改动这段字符串后务必检查产物：`grep -c '</html>' public/<page>/index.html` 必须为 1。
const MATHJAX_CONFIG = `<script>
window.MathJax = { tex: { inlineMath: [["\$", "\$"]] } };
</script>`;

function mathjaxLoader() {
  const stellar = hexo.config.stellar || {};
  const mathConfig = (stellar.features && stellar.features.math) || {};
  const src =
    (mathConfig.mathjax && mathConfig.mathjax.js) ||
    "https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-mml-chtml.min.js";
  return `${MATHJAX_CONFIG}<script id="MathJax-script" async src="${src}"></script>`;
}

hexo.extend.filter.register("before_post_render", data => {
  if (typeof data.content === "string" && data.content.includes("$")) {
    data.content = protectMath(data.content);
  }
  return data;
}, 9);

hexo.extend.filter.register("after_post_render", data => {
  if (typeof data.content === "string" && data.content.includes(DISPLAY_OPEN)) {
    data.content = restoreDisplayMath(data.content);
  }
  return data;
}, 9);

// 只在含公式的页面注入 MathJax；after_render:html 也会拿到 search.json 等非 HTML 输出，
// 因此必须确认存在 <head>。
hexo.extend.filter.register("after_render:html", html => {
  if (typeof html !== "string" || !html.includes("</head>")) return html;
  if (!html.includes(DISPLAY_OPEN) && !/\$[^$\n]+\$/.test(html)) return html;
  return html.replace("</head>", `${mathjaxLoader()}</head>`);
}, 9);

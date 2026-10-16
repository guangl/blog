/* global hexo */
/**
 * Mermaid 图表插件（构建期）
 *
 * 主题的 diagrams 扩展靠选择器 `.mermaid` 激活，然后加载 Mermaid 把节点渲染成图。
 * 但 hexo-renderer-marked 会把 ```mermaid 代码块输出成普通高亮代码块，不带 .mermaid 类，
 * 所以扩展永远不会激活。
 *
 * 官方文档建议安装 hexo-filter-mermaid-diagrams 做这层转换。这里用等价的本地实现，
 * 避免引入该包（最后更新于 2022 年，且依赖已废弃的 deep-assign）：
 * 在 before_post_render 阶段把 ```mermaid 围栏换成 <pre class="mermaid">，
 * marked 会把裸 HTML 块原样透传。
 *
 * 需要 _config.stellar.yml 中 features.diagrams.provider 为 mermaid。
 */

"use strict";

// 匹配 ```mermaid / ~~~mermaid 围栏，捕获前导换行、缩进、围栏符号与图表正文
const FENCE = /(^|\n)([ \t]*)(```|~~~)[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\r?\n?\2\3[ \t]*(?=\n|$)/g;

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function convertMermaid(content) {
  return content.replace(FENCE, (raw, lead, indent, fence, diagram) => {
    const body = diagram.trim();
    if (body.length === 0) return raw;
    // 图表正文按文本节点处理，转义 HTML 特殊字符，避免被当成标签
    return `${lead}<pre class="mermaid">${escapeHtml(body)}</pre>`;
  });
}

hexo.extend.filter.register("before_post_render", data => {
  if (typeof data.content === "string" && /```[ \t]*mermaid|~~~[ \t]*mermaid/.test(data.content)) {
    data.content = convertMermaid(data.content);
  }
  return data;
}, 8);

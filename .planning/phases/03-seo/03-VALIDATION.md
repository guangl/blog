---
phase: 3
slug: seo
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-25
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Hexo 构建验证（shell 命令，无 JS 测试框架） |
| **Config file** | none（静态站点，不使用 jest/vitest） |
| **Quick run command** | `bun run build && ls public/sitemap.xml` |
| **Full suite command** | `bun run build && grep -r "og:title" public/ \| head -5` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run build`（确认无构建错误）
- **After every plan wave:** Run `bun run build && ls public/sitemap.xml && ls public/categories/`
- **Before `/gsd:verify-work`:** 完整构建 + 人工检查任意一篇文章 HTML 的 og 标签
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | CONT-03 | — | N/A | smoke | `bun run build && ls public/categories/技术教程/` | ❌ Wave 0 | ⬜ pending |
| 3-01-02 | 01 | 1 | SEO-01 | — | N/A | smoke | `bun run build && grep "og:title" public/2026/*/*/index.html \| head -3` | ❌ Wave 0 | ⬜ pending |
| 3-02-01 | 02 | 2 | SEO-02 | — | N/A | smoke | `bun run build && test -f public/sitemap.xml && echo PASS` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

三条验证命令均为构建后 shell 检查，无需额外测试文件。唯一前置条件是文章和插件存在（Phase 3 任务本身创建）。

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| og:description 内容不为空 | SEO-01 | grep 只检查标签存在，内容非空需人工查看 | `bun run build` 后在浏览器中查看任意文章页面源码，确认 `og:description` content 属性有实质内容（非空字符串） |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

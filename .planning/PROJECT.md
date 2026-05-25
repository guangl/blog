# guangluo's blog

## What This Is

基于 Hexo + Stellar 主题的个人技术博客。面向技术读者，涵盖 Rust 系统编程、全栈开发实践、读书笔记和个人思考。部署在 GitHub Pages，中文写作。

## Core Value

让每一篇文章都值得被搜索到——内容真实、结构清晰、有实际参考价值。

## Current Milestone: v1.0 全面启动

**Goal:** 从零搭建一个内容完整、主题配置完善、自动部署到 GitHub Pages 的个人技术博客。

**Target features:**
- 仓库基础文件（README、LICENSE）
- 内容分类体系（技术教程、项目心得、读书笔记、个人思考）
- 个人信息与导航配置
- SEO 元数据
- GitHub Pages CI/CD 自动部署
- 各分类首篇示例文章

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] 仓库有 README 和 LICENSE 文件
- [ ] 博客内容分为技术教程、项目心得、读书笔记、个人思考四个类别
- [ ] 博主头像和简介展示在博客中
- [ ] 导航菜单按内容类别组织
- [ ] SEO 元数据（Open Graph、description）已配置
- [ ] GitHub Actions 自动构建并部署到 GitHub Pages
- [ ] 每个内容类别有至少一篇示例文章

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- 自定义域名 — 使用 GitHub Pages 默认域名，简化初始配置
- 评论系统 — v1 专注内容和部署，评论是社交功能，留到后续
- 搜索功能 — 内容量不足时搜索价值有限，后续添加

## Context

- Hexo v6+，Stellar 主题，pnpm 管理依赖
- 语言：zh-CN；永久链接：`:year/:month/:day/:title/`
- 目前仅有 hello-world 示例文章，无任何真实内容
- 作者是全栈工程师，主攻 Rust
- 部署目标：GitHub Pages（username.github.io 格式）

## Constraints

- **Tech stack**: Hexo + Stellar — 不引入其他静态站点生成器
- **Language**: 中文写作为主 — 所有 UI 文本和内容使用 zh-CN
- **Hosting**: GitHub Pages — 无服务器费用

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Stellar 主题 | 功能丰富、文档完善，适合技术博客 | — Pending |
| pnpm 包管理 | 比 npm 更快，磁盘占用更少 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-25 after milestone v1.0 started*

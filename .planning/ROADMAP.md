# Roadmap: guangluo's blog

## Overview

从仓库基础开始，逐步建立内容分类体系和主题配置，添加 SEO 支持，最终通过 GitHub Actions 实现自动部署到 GitHub Pages。四个阶段依次交付可验证的能力，每阶段完成后博客处于一个可用状态。

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: 仓库基础** - 建立仓库基础文件并完成包管理器迁移
- [ ] **Phase 2: 主题与内容结构** - 配置 Stellar 主题个人信息和内容分类导航
- [ ] **Phase 3: 内容与 SEO** - 发布各分类示例文章并配置 SEO 元数据
- [ ] **Phase 4: 自动部署** - 配置 GitHub Actions 实现推送即部署

## Phase Details

### Phase 1: 仓库基础
**Goal**: 仓库有完整的基础文件，开发工具链使用 bun
**Depends on**: Nothing (first phase)
**Requirements**: REPO-01, REPO-02, REPO-03
**Success Criteria** (what must be TRUE):
  1. README 文件存在，包含项目说明、本地运行步骤和技术栈说明
  2. LICENSE 文件存在，明确版权信息
  3. bun.lockb 存在，pnpm-lock.yaml 不存在，`bun install` 可以成功安装依赖
  4. `bun run server` 能正常启动开发服务器
**Plans**: TBD

### Phase 2: 主题与内容结构
**Goal**: 博客展示作者身份，导航按内容分类组织，分类体系完整
**Depends on**: Phase 1
**Requirements**: CONT-01, CONT-02, THEME-01, THEME-02, THEME-03
**Success Criteria** (what must be TRUE):
  1. 博客页面展示作者头像、姓名和简介
  2. 导航菜单包含技术教程、项目心得、读书笔记、个人思考四个入口
  3. 每个分类有对应的分类页面可访问
  4. 网站 description 和 keywords 在 HTML `<head>` 中可见
**Plans**: TBD
**UI hint**: yes

### Phase 3: 内容与 SEO
**Goal**: 博客有真实可读内容，搜索引擎能正确索引和预览
**Depends on**: Phase 2
**Requirements**: CONT-03, SEO-01, SEO-02
**Success Criteria** (what must be TRUE):
  1. 至少 1–2 篇示例文章，分类标注正确（D-04 放宽了原 ROADMAP 要求）
  2. 每篇文章页面的 HTML `<head>` 中有 og:title 和 og:description 标签
  3. `bun run build` 后 public/ 目录中存在 sitemap.xml
**Plans**: 2 plans
Plans:
- [ ] 03-01-PLAN.md — 创建两篇分类示例文章并确认 Open Graph 配置（CONT-03, SEO-01）
- [ ] 03-02-PLAN.md — 安装 hexo-generator-sitemap 并验证构建输出（SEO-02）

### Phase 4: 自动部署
**Goal**: 推送代码到 main 分支后博客自动构建并发布到 GitHub Pages
**Depends on**: Phase 3
**Requirements**: DEPLOY-01
**Success Criteria** (what must be TRUE):
  1. .github/workflows/ 下存在部署 workflow 文件
  2. 推送到 main 分支后 GitHub Actions 自动运行构建并部署
  3. 部署完成后可通过 GitHub Pages URL 访问博客
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. 仓库基础 | 0/? | Not started | - |
| 2. 主题与内容结构 | 0/? | Not started | - |
| 3. 内容与 SEO | 0/2 | Not started | - |
| 4. 自动部署 | 0/? | Not started | - |

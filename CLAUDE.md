# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm run server    # dev server at http://localhost:4000
pnpm run build     # generate static files to public/
pnpm run clean     # clear generated files and cache (db.json)
pnpm run deploy    # deploy to remote (deploy target not yet configured in _config.yml)

# Create new content
npx hexo new post "Post Title"    # new post in source/_posts/
npx hexo new draft "Post Title"   # new draft in source/_drafts/
npx hexo publish "Draft Title"    # move draft to _posts
```

## Architecture

This is a [Hexo](https://hexo.io/) static site using the **Stellar** theme (`hexo-theme-stellar`).

**Configuration split:**
- `_config.yml` — site-wide Hexo config (URL, permalink format, pagination, theme selection)
- `_config.stellar.yml` — Stellar theme overrides (currently empty; Stellar defaults apply)

**Content:**
- `source/_posts/` — published posts (Markdown with YAML front matter)
- `source/_drafts/` — draft posts (not rendered unless `render_drafts: true`)
- `scaffolds/` — templates used when `hexo new` creates content

**Post front matter** (from scaffold):
```yaml
---
title: {{ title }}
date: {{ date }}
tags:
---
```

The site language is `zh-CN`. Permalinks use `:year/:month/:day/:title/` format.

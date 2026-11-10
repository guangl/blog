# Repository Guidelines

## Project Structure

This is a Hexo site using the Stellar theme. Published articles live in `source/_posts/`, drafts in `source/_drafts/`, and standalone pages in directories such as `source/about/` and `source/gallery/`. Keep post assets in the post's same-named directory, shared images in `source/images/`, and structured content in `source/_data/`. Use `scripts/` for Hexo build hooks and `tools/` for standalone utilities and tests. Site settings live in `_config.yml`, theme settings in `_config.stellar.yml`, and deployment output settings in `_config.domain.yml`.

## Build and Preview

Use Node.js 22 or later and Bun 1.4.3.

- `bun install --frozen-lockfile` installs the dependencies pinned by CI.
- `bun run server` starts the local preview. `bun run server:domain` previews the deployment configuration on port 4001.
- `bun run build` generates `public/`. `bun run build:domain` generates `public-domain/`. Keep both generated directories out of Git.

## Style and Naming

Match the surrounding JavaScript style. Use two-space indentation and semicolons. Follow the existing CommonJS pattern for Hexo hooks and use `.mjs` for standalone Node tools. Start new articles with `bunx hexo new post "文章标题"` and follow `scaffolds/post.md` for front matter. Preserve published slugs and dates to keep existing URLs working. Give images descriptive alt text and record photo metadata in `source/_data/photos.yml`.

## Verification

Run `bun run verify` and `bun run verify:domain` before opening a PR. Both run Stellar diagnostics, rebuild from scratch, and check generated links, assets, and SEO output. Run `node --test tools/dnspod-validation.test.mjs` for DNSPod validation and name related Node tests `*.test.mjs`. For layout or accessibility changes, build `public/` and run `bun run browser:a11y` and `bun run browser:a11y:dark` with Chrome installed.

## Commits and Pull Requests

Use short, scoped subjects such as `docs: add repository guidelines` or `fix: refresh homepage article list`. Push a feature branch and open a PR against `main`. Describe the change, list verification results, link relevant issues, and include screenshots for visible changes. Wait for CI and maintainer approval before merging.

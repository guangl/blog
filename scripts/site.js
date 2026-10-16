'use strict';

const { escapeHTML } = require('hexo-util');

function migrateContent(content, config) {
  const migration = config.domain_migration;
  if (!migration || typeof content !== 'string') return content;
  const oldRoot = migration.from_root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedRoot = escapeHTML(migration.from_root).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content
    .replaceAll(migration.from_url, config.url.replace(/\/$/, ''))
    .replace(new RegExp(`(\\b(?:href|src|data-src|poster)=["'])${oldRoot}`, 'g'), '$1' + config.root)
    .replace(new RegExp(`(\\b(?:href|src|data-src|poster)=["'])${escapedRoot}`, 'g'), '$1' + escapeHTML(config.root));
}

// Source articles remain usable on GitHub Pages and the custom domain.
hexo.extend.filter.register('after_post_render', function (data) {
  data.content = migrateContent(data.content, this.config);
  data.excerpt = migrateContent(data.excerpt, this.config);
  const migration = this.config.domain_migration;
  if (migration) {
    for (const field of ['cover', 'banner']) {
      if (typeof data[field] === 'string' && data[field].startsWith(migration.from_root)) {
        data[field] = this.config.root + data[field].slice(migration.from_root.length);
      }
    }
  }
  return data;
}, 20);

hexo.extend.generator.register('custom_domain_robots', function () {
  if (!this.config.domain_migration) return [];
  return {
    path: 'robots.txt',
    data: `User-agent: *\nAllow: ${this.config.root}\n\nSitemap: ${this.config.url.replace(/\/?$/, '/')}sitemap.xml\n`
  };
});

// Keep canonical URLs tied to the configured project path, including pagination.
hexo.extend.filter.register('template_locals', function (locals) {
  const page = locals.page;
  if (locals.path !== '404.html') {
    const path = locals.path.replace(/index\.html$/, '');
    const href = new URL(path, this.config.url.replace(/\/?$/, '/')).href;
    page.inject = { ...page.inject, head: [
      ...(page.inject?.head || []),
      `<link rel="canonical" href="${escapeHTML(href)}">`
    ] };
  }
  return locals;
});

// Small theme extensions live here so theme package updates remain straightforward.
hexo.extend.filter.register('after_render:html', function (html) {
  if (!html.includes('<html')) return html;
  const root = this.config.root;
  const link = path => escapeHTML(root + path);
  html = html.replace('content="width=device-width, initial-scale=1, maximum-scale=1"',
    'content="width=device-width, initial-scale=1"');
  html = html.replace('<body>', '<body><a class="skip-link" href="#main">跳到正文</a>');
  html = html.replace('id="main" data-ui-surface="content"',
    'id="main" role="main" tabindex="-1" data-ui-surface="content"');
  const nav = `<nav class="site-nav" aria-label="站点导航">
    <div class="site-nav-links">
      <a href="${link('')}">文章</a><a href="${link('archives/')}">归档</a>
      <a href="${link('about/')}">关于</a><a href="${link('subscribe/')}">订阅</a>
    </div>
    <button class="theme-toggle" type="button" hidden>外观：跟随系统</button>
  </nav>`;
  html = html.replace(/(<div class="l_main"[^>]*>)/, '$1' + nav);
  // Stellar 1.x passes config.root through url_for again in the breadcrumb.
  html = html.replaceAll(`class="cap breadcrumb" href="${root + root.slice(1)}"`,
    `class="cap breadcrumb" href="${root}"`);
  const canonical = `<link rel="canonical" href="${escapeHTML(this.config.url.replace(/\/?$/, '/'))}">`;
  if (html.includes(canonical)) {
    const intro = `<section class="site-intro" aria-labelledby="intro-title">
      <p class="eyebrow">DATABASE / OPERATIONS / LIFE</p>
      <h1 id="intro-title">记录问题，也记录风景。</h1>
      <p>数据库管理、运维经验，与镜头里的日常。<br>把值得留下的经验，慢慢写在这里。</p>
      <a href="${link('about/')}">认识这个小站 <span aria-hidden="true">↗</span></a>
    </section>`;
    html = html.replace('<div class="navbar top">', intro + '<div class="navbar top">');
  }
  html = html.replace("class='mobile-only leftbar-toggle mobile'", "aria-label='打开导航和站内搜索' class='mobile-only leftbar-toggle mobile'");
  html = html.replace("class='laptop-only rightbar-toggle mobile'", "aria-label='打开文章目录' class='laptop-only rightbar-toggle mobile'");
  return migrateContent(html, this.config);
}, 20);

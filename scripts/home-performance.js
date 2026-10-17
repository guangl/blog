/* global hexo */
'use strict';

// Only rewrite the generated homepage. Keep the theme and other pages intact.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { load } = require('cheerio');
const { transformSync } = require('esbuild');

hexo.extend.filter.register('after_generate', async () => {
  const readRoute = async name => {
    const stream = hexo.route.get(name);
    if (!stream) throw new Error(`Homepage asset missing: ${name}`);
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  };
  const $ = load(await readRoute('index.html'), { decodeEntities: false });
  const emit = (name, content, loader) => {
    const code = transformSync(content, { loader, minify: true, target: 'es2020', legalComments: 'eof' }).code;
    const hash = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
    const relative = `home-assets/${name}.${hash}.${loader}`;
    hexo.route.set(relative, code);
    return '/' + relative;
  };
  const localFile = href => new URL(href, 'https://local.invalid').pathname.replace(/^\//, '');

  // Minify rather than purge selectors: menus, search and dark mode need states
  // that are absent from the initial DOM.
  const css = $('link[rel="stylesheet"]').filter((_, el) => /^\/css\/main\.css(?:\?|$)/.test($(el).attr('href')));
  if (css.length) {
    const href = emit('main', await readRoute(localFile(css.attr('href'))), 'css');
    css.attr('href', href);
    $('link[rel="preload"][as="style"]').filter((_, el) => /^\/css\/main\.css(?:\?|$)/.test($(el).attr('href'))).attr('href', href);
  }

  // Preserve execution order and the theme's global bindings, then defer until the
  // document is parsed. The inline defines script remains before this bundle.
  const scripts = ['utils', 'main', 'profile', 'navigation-init'].map(name =>
    $(`script[src]`).filter((_, el) => new RegExp(`^/js/${name}\\.js(?:\\?|$)`).test($(el).attr('src'))));
  if (scripts.every(elements => elements.length === 1)) {
    const code = (await Promise.all(scripts.map(async elements => (await readRoute(localFile(elements.attr('src')))) + '\n;'))).join('\n');
    const src = emit('core', code, 'js');
    scripts[0].attr('src', src).attr('defer', '');
    scripts.slice(1).forEach(elements => elements.remove());
  }

  // A static repository link needs no API calls or live counters.
  $('.widget-instance--ghrepo .items').html('<a class="repo" href="https://github.com/guangl/blog" target="_blank" rel="external nofollow noopener noreferrer"><div class="repo-name flex-row">guangl/blog</div><div class="repo-desc">本站源码 · 查看 GitHub 仓库</div></a>')
    .removeClass('data-service ds-ghinfo').removeAttr('data-api');
  $('img[no-lazy]').attr('loading', 'eager').attr('width', '280').attr('height', '280');

  const manifest = $('#stellar-runtime-config');
  if (manifest.length) {
    const config = JSON.parse(manifest.text());
    const lazy = config.extensions.find(extension => extension.id === 'lazy-loading');
    if (lazy) {
      // Keep the document-scoped adapter for navigation, but serve its pinned
      // dependency from this site instead of making a third-party connection.
      hexo.route.set('home-assets/lazyload-LICENSE.txt', fs.readFileSync(path.join(hexo.base_dir, 'node_modules/vanilla-lazyload/LICENSE'), 'utf8'));
      lazy.config.asset = emit('lazyload', fs.readFileSync(path.join(hexo.base_dir, 'node_modules/vanilla-lazyload/dist/lazyload.min.js'), 'utf8'), 'js');
    }
    manifest.text(JSON.stringify(config).replace(/</g, '\\u003c'));
  }
  // Preload the runtime's first dependency layer without changing its lifecycle.
  const runtime = $('script[type="module"][src]').attr('src');
  if (runtime && runtime.startsWith('/js/runtime/index.js')) {
    const query = runtime.includes('?') ? runtime.slice(runtime.indexOf('?')) : '';
    for (const name of ['asset-loader', 'extension-registry', 'legacy-request-adapter', 'request-cache']) {
      $('head').append(`<link rel="modulepreload" href="/js/runtime/${name}.js${query}">`);
    }
  }
  hexo.route.set('index.html', $.html());
}, 100);

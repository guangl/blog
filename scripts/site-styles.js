/* global hexo */
'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const sharp = require('sharp');
const { load } = require('cheerio');
const postcss = require('postcss');
const selectorParser = require('postcss-selector-parser');
const { transformSync } = require('esbuild');

// These attributes describe authored content and do not change while the
// page is displayed. Matching them avoids inlining every article/card variant.
const STATIC_ATTRIBUTES = new Set([
  'data-article-style', 'data-page-layout', 'data-text-indent', 'data-regions',
  'data-region', 'data-variant', 'data-layout', 'data-density', 'data-leftbar-rail',
  'color', 'bg', 'size', 'child', 'symbol', 'align', 'type', 'direction',
  'indent', 'highlight', 'aspect_ratio'
]);

// Match the page across hover/focus, pseudo elements, media queries and shell
// state changes. These relaxed selectors are only used to select rules. The
// emitted selectors and their enclosing conditions remain exactly as authored.
function relaxedSelector(selector) {
  const ast = selectorParser().astSync(selector);
  const wildcard = () => selectorParser.pseudo({
    value: ':is', nodes: [selectorParser.selector({ nodes: [selectorParser.universal()] })]
  });
  ast.walkPseudos(node => {
    if (node.value !== ':root') node.replaceWith(wildcard());
  });
  ast.walkAttributes(node => {
    if (!STATIC_ATTRIBUTES.has(node.attribute)) node.replaceWith(wildcard());
  });
  ast.walkClasses(node => {
    if (/^(?:is-|has-)|^(?:active|display|show|hide|hidden|collapse|collapsed|expanded|loaded|loading|noresult)$/.test(node.value)) {
      node.replaceWith(wildcard());
    }
  });
  return ast.toString();
}

function criticalStyles(tree, $) {
  const critical = tree.clone();
  const matches = new Map();
  critical.walkRules(rule => {
    // Keyframes, and future nested CSS syntax, are retained conservatively.
    if (rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    if (rule.nodes.some(node => node.type !== 'decl' && node.type !== 'comment')) return;
    const selectors = rule.selectors.filter(selector => {
      if (!matches.has(selector)) {
        try {
          matches.set(selector, $(relaxedSelector(selector)).length > 0);
        } catch {
          // Unknown selector syntax must never make visible content unstyled.
          matches.set(selector, true);
        }
      }
      return matches.get(selector);
    });
    if (selectors.length) rule.selectors = selectors;
    else rule.remove();
  });
  critical.walkAtRules(rule => {
    if (/^(?:media|supports)$/.test(rule.name) && rule.nodes?.length === 0) rule.remove();
  });
  // Animation declarations may refer to a custom property resolved at runtime.
  // Keep all keyframes in that case, otherwise retain only referenced names.
  const animations = [];
  const collectAnimations = styles => styles.walkDecls(/^(?:-\w+-)?animation(?:-name)?$/,
    declaration => animations.push(declaration.value));
  collectAnimations(critical);
  try {
    // Authored inline styles can also reference the theme's keyframes.
    collectAnimations(postcss.parse($('style').text()));
    $('[style]').each((_, element) => collectAnimations(postcss.parse($(element).attr('style'))));
  } catch {
    return minify(critical.toString());
  }
  const animationValues = animations.join(' ');
  if (!animationValues.includes('var(') && !animationValues.includes('\\')) {
    critical.walkAtRules(/keyframes$/i, rule => {
      const name = rule.params.replace(/^['"]|['"]$/g, '');
      if (name.includes('\\')) return;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`(^|[^\\w-])${escaped}($|[^\\w-])`).test(animationValues)) rule.remove();
    });
  }
  return minify(critical.toString());
}

function minify(css) {
  return transformSync(css, { loader: 'css', minify: true, legalComments: 'eof', target: 'es2020' }).code;
}

hexo.extend.filter.register('after_generate', async () => {
  const readRoute = async name => {
    const stream = hexo.route.get(name);
    if (!stream) throw new Error(`Stylesheet route missing: ${name}`);
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  };
  const source = await readRoute('css/main.css');
  const tree = postcss.parse(source);
  const full = minify(source);
  const hash = crypto.createHash('sha256').update(full).digest('hex').slice(0, 16);
  const asset = `site-assets/main.${hash}.css`;
  hexo.route.set(asset, full);
  const href = hexo.extend.helper.get('url_for').call(hexo, asset);
  const icons = minify(await readRoute('css/stellar-icons.css'));
  const avatar = await sharp(path.join(hexo.source_dir, 'images/avatar.png')).metadata();
  const avatarHref = hexo.extend.helper.get('url_for').call(hexo, 'images/avatar.png');

  for (const route of hexo.route.list().filter(name => name.endsWith('.html'))) {
    const $ = load(await readRoute(route));
    const main = $('link[rel="stylesheet"][href]').filter((_, link) =>
      /\/css\/main\.css(?:\?|$)/.test($(link).attr('href')));
    if (main.length !== 1) continue;

    // Native lazy loading starts as soon as the browser sees an image, including
    // when JavaScript is disabled. The theme adapter remains for dynamic widgets.
    $('img.lazy[data-src]').each((_, element) => {
      const image = $(element);
      image.attr('src', image.attr('data-src')).removeAttr('data-src')
        .attr('loading', 'lazy').attr('decoding', 'async').removeClass('lazy');
      if (image.attr('data-srcset')) image.attr('srcset', image.attr('data-srcset')).removeAttr('data-srcset');
      if (image.attr('data-sizes')) image.attr('sizes', image.attr('data-sizes')).removeAttr('data-sizes');
      image.parent('.lazy-box').children('.lazy-icon').remove();
    });

    $('img[no-lazy]').filter((_, image) => $(image).attr('src') === avatarHref)
      .attr('width', String(avatar.width)).attr('height', String(avatar.height));

    // The first album photo is visible on both mobile and desktop. Let the
    // preload scanner discover it before layout-dependent lazy loading runs.
    if (route === 'gallery/index.html') {
      $('img.gallery-photo[data-fancybox="gallery-site"]').first()
        .attr('loading', 'eager').attr('fetchpriority', 'high');
    }

    const critical = criticalStyles(tree, $);
    // Place the full stylesheet after the critical subset, in the original main
    // CSS position. Later injected overrides retain their original precedence.
    main.replaceWith(`<style data-stellar-critical>${critical.replace(/<\/style/gi, '<\\/style')}</style>`
      + `<link rel="preload" as="style" href="${href}" fetchpriority="low" data-stellar-page-style onload="this.onload=null;this.rel='stylesheet'">`
      + `<noscript><link rel="stylesheet" href="${href}"></noscript>`);
    $('link[rel="preload"][as="style"][href]').filter((_, link) =>
      /\/css\/main\.css(?:\?|$)/.test($(link).attr('href'))).remove();
    // Icon custom properties are tiny and must preserve their later position in
    // the cascade, after the site's injected styles.
    $('link[rel="stylesheet"][href]').filter((_, link) =>
      /\/css\/stellar-icons\.css(?:\?|$)/.test($(link).attr('href')))
      .replaceWith(`<style data-stellar-icons>${icons.replace(/<\/style/gi, '<\\/style')}</style>`);
    hexo.route.set(route, $.html());
  }
}, 120);

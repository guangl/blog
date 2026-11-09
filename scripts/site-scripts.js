/* global hexo */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { load } = require('cheerio');
const { build, transformSync } = require('esbuild');

hexo.extend.filter.register('after_generate', async () => {
  const routes = new Map();
  const readRoute = name => {
    if (!routes.has(name)) {
      routes.set(name, (async () => {
        const stream = hexo.route.get(name);
        if (!stream) throw new Error(`Site script asset missing: ${name}`);
        const chunks = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks).toString('utf8');
      })());
    }
    return routes.get(name);
  };
  const emit = (name, content, extension = 'js') => {
    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    const route = `site-assets/${name}.${hash}.${extension}`;
    hexo.route.set(route, content);
    return hexo.extend.helper.get('url_for').call(hexo, route);
  };
  const minify = content => transformSync(content, {
    loader: 'js', minify: true, target: 'es2020', legalComments: 'eof'
  }).code;
  const localRoute = href => {
    const pathname = new URL(href, hexo.config.url).pathname;
    return pathname.slice((hexo.config.root || '/').length);
  };

  // The runtime's four mandatory dependencies form one download. Extensions
  // retain their own selector-based imports and lifecycle management.
  const runtimeRoute = 'js/runtime/index.js';
  let runtime = await readRoute(runtimeRoute);
  const dependencies = ['asset-loader', 'extension-registry', 'legacy-request-adapter', 'request-cache'];
  const imports = dependencies.map((name, index) => {
    const expression = 'import(`./' + name + '.js${RUNTIME_QUERY}`)';
    if (!runtime.includes(expression)) throw new Error(`Runtime dependency changed: ${name}`);
    runtime = runtime.replace(expression, `runtimeDependency${index}`);
    return `import * as runtimeDependency${index} from './${name}.js';`;
  });
  const result = await build({
    stdin: { contents: imports.join('\n') + '\n' + runtime, sourcefile: runtimeRoute },
    bundle: true, write: false, format: 'esm', platform: 'browser',
    minify: true, target: 'es2020', legalComments: 'eof',
    plugins: [{
      name: 'generated-runtime',
      setup(builder) {
        builder.onResolve({ filter: /^\.\// }, args => ({
          path: path.posix.join('js/runtime', args.path), namespace: 'generated-runtime'
        }));
        builder.onLoad({ filter: /.*/, namespace: 'generated-runtime' }, async args => ({
          contents: await readRoute(args.path), loader: 'js'
        }));
      }
    }]
  });
  const runtimeHref = emit('runtime', result.outputFiles[0].text);
  const lazyDirectory = path.join(hexo.base_dir, 'node_modules/vanilla-lazyload');
  const lazyHref = emit('lazyload', minify(fs.readFileSync(path.join(lazyDirectory, 'dist/lazyload.min.js'), 'utf8')));
  emit('lazyload-LICENSE', fs.readFileSync(path.join(lazyDirectory, 'LICENSE'), 'utf8'), 'txt');
  const bundles = new Map();

  for (const route of hexo.route.list().filter(name => name.endsWith('.html'))) {
    const $ = load(await readRoute(route), { decodeEntities: false });
    const client = $('script[src]').filter((_, node) => localRoute($(node).attr('src')) === 'js/stellar-icons.js');
    if (!client.length) continue; // Non-theme pages and previously processed routes.
    const defines = $('script[data-stellar-script="defines"]');
    const canonical = $('script[data-stellar-no-canonical-tip]');
    const core = ['utils', 'main', 'profile', 'navigation-init'].map(name =>
      $('script[src]').filter((_, node) => localRoute($(node).attr('src')) === `js/${name}.js`));
    const ordered = [client, defines, canonical, ...core];
    if (!ordered.every(elements => elements.length === 1)) {
      throw new Error(`Theme script order changed in ${route}`);
    }

    // Only the permalink varies across pages. Store it on the script element so
    // the complete deferred bundle is shared, including pages without canonical.
    const permalink = /permalink:\s*("(?:[^"\\]|\\.)*")/;
    const definition = defines.text();
    const match = definition.match(permalink);
    if (!match) throw new Error(`Page permalink definition changed in ${route}`);
    const sharedDefines = definition.replace(permalink,
      'permalink: document.currentScript.dataset.stellarPermalink');
    const code = await Promise.all(ordered.map(elements => {
      if (elements === defines) return sharedDefines;
      const src = elements.attr('src');
      return src ? readRoute(localRoute(src)) : elements.text();
    }));
    const source = code.join('\n;\n');
    if (!bundles.has(source)) bundles.set(source, emit('core', minify(source)));
    client.attr('src', bundles.get(source)).attr('defer', '').attr('data-stellar-no-canonical-tip', '')
      .attr('data-stellar-permalink', JSON.parse(match[1]));
    ordered.slice(1).forEach(elements => elements.remove());
    $('link[rel="preload"][as="script"]').filter((_, node) =>
      localRoute($(node).attr('href')) === 'js/stellar-icons.js').remove();

    const manifest = $('#stellar-runtime-config');
    if (manifest.length) {
      const config = JSON.parse(manifest.text());
      const lazy = config.extensions.find(extension => extension.id === 'lazy-loading');
      if (lazy) lazy.config.asset = '/' + localRoute(lazyHref);
      manifest.text(JSON.stringify(config).replace(/</g, '\\u003c'));
    }
    const bootstrap = $('script[type="module"][src]').filter((_, node) => localRoute($(node).attr('src')) === runtimeRoute);
    const query = new URL(bootstrap.attr('src'), hexo.config.url).search;
    bootstrap.attr('src', runtimeHref + query).attr('fetchpriority', 'low');
    hexo.route.set(route, $.html());
  }
}, 110);

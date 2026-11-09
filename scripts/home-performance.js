/* global hexo */
'use strict';

// Only rewrite the generated homepage. Keep the theme and other pages intact.
const { load } = require('cheerio');

hexo.extend.filter.register('after_generate', async () => {
  const readRoute = async name => {
    const stream = hexo.route.get(name);
    if (!stream) throw new Error(`Homepage asset missing: ${name}`);
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  };
  const $ = load(await readRoute('index.html'), { decodeEntities: false });
  // Use generated post routes so drafts, future and excluded posts stay hidden.
  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const posts = hexo.locals.get('posts').toArray()
    .filter(post => post.published !== false && hexo.route.get(post.path))
    .sort((a, b) => Number(b.updated || b.date) - Number(a.updated || a.date)
      || Number(b.date) - Number(a.date))
    .slice(0, 6);
  const recent = '<ul class="home-recent-posts">' + posts.map(post => {
    const date = post.updated || post.date;
    const stamp = date.tz(hexo.config.timezone || 'Asia/Shanghai').format('YYYY-MM-DD');
    return `<li><a href="${escapeHtml(hexo.extend.helper.get('url_for').call(hexo, post.path))}">${escapeHtml(post.title)}</a>`
      + ` <small>更新于 <time datetime="${stamp}">${stamp}</time></small>`
      + (post.description ? `<p>${escapeHtml(post.description)}</p>` : '') + '</li>';
  }).join('') + '</ul>';
  const replaceMarker = node => {
    for (const child of [...(node.children || [])]) {
      if (child.type === 'comment' && child.data.trim() === 'home-recent-posts') $(child).replaceWith(recent);
      else replaceMarker(child);
    }
  };
  replaceMarker($.root()[0]);
  // A static repository link needs no API calls or live counters.
  $('.widget-instance--ghrepo .items').html('<a class="repo" href="https://github.com/guangl/blog" target="_blank" rel="external nofollow noopener noreferrer"><div class="repo-name flex-row">guangl/blog</div><div class="repo-desc">本站源码 · 查看 GitHub 仓库</div></a>')
    .removeClass('data-service ds-ghinfo').removeAttr('data-api');
  $('img[no-lazy]').attr('loading', 'eager').attr('width', '280').attr('height', '280');

  hexo.route.set('index.html', $.html());
}, 100);

// Bundled as js/runtime/extensions/search.js so imports resolve to theme assets.
import { searchCacheKey, clearSearchStorage } from '../request-cache.js';
import '../../search/shortcut.js';

export function mount(root, context) {
  const config = context.extension.config;
  const assets = context.assets;
  let pending = null;
  let providerCleanup;
  let disposed = false;
  const shortcutCleanup = window.stellarSearchShortcut.mount(root);

  function activate() {
    if (pending || disposed) return;
    pending = (async () => {
      if (config.provider === 'algolia') {
        window.searchConfig = Object.assign({}, config.options, {
          js: config.assets.client,
          hitsPerPage: 100
        });
        await assets.script(config.assets.client);
      }
      await assets.script(config.assets.provider);
      context.signal.throwIfAborted();
      providerCleanup = config.provider === 'algolia'
        ? window.stellarAlgoliaSearch?.mount?.(root)
        : window.stellarLocalSearch?.mount?.(root, { key: searchCacheKey, clear: clearSearchStorage });
      // The first focus may precede the downloaded provider's event listeners.
      root.querySelector('dialog[open] .search-input')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      if (config.provider === 'algolia') {
        const input = root.querySelector('.search-input');
        if (input?.value.trim()) input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })().catch(error => {
      pending = null;
      if (!disposed) context.reportError(error);
    });
  }

  const onFocus = event => {
    if (event.target.matches?.('.search-input')) activate();
  };
  const onClick = event => {
    if (event.target.closest?.('[data-shell-action="open-search"]')) activate();
  };
  root.addEventListener('focusin', onFocus);
  root.addEventListener('input', onFocus);
  root.addEventListener('click', onClick);
  const input = root.querySelector('.search-input');
  if (input?.value.trim() || input === document.activeElement || window.ctx?.search?.local_search?.lazy_load === false) activate();

  return () => {
    disposed = true;
    root.removeEventListener('focusin', onFocus);
    root.removeEventListener('input', onFocus);
    root.removeEventListener('click', onClick);
    shortcutCleanup?.();
    providerCleanup?.();
  };
}

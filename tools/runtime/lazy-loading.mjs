export function mount(root, context) {
  if (root.nodeType !== 9) throw new TypeError('The lazy-loading adapter requires a document root');
  let instance = null;
  let pending = null;
  let disposed = false;

  function update() {
    if (disposed) return;
    if (instance) {
      instance.update();
      return;
    }
    if (pending || !root.querySelector('.lazy')) return;
    pending = context.assets.script(context.extension.config.asset).then(() => {
      context.signal.throwIfAborted();
      if (!instance) instance = new window.LazyLoad(options);
      window.lazyLoadInstance = instance;
      instance.update();
    }).catch(error => {
      pending = null;
      if (!disposed) context.reportError(error);
    });
  }

  const wrapLazyloadImages = container => {
    const target = typeof container === 'string' ? root.querySelector(container) : container;
    if (!target) return;
    target.querySelectorAll('img').forEach(image => {
      if (image.classList.contains('lazy')) return;
      const src = image.getAttribute('src');
      if (!src) return;
      const wrapper = root.createElement('div');
      wrapper.className = 'lazy-box';
      const lazyImage = image.cloneNode();
      lazyImage.removeAttribute('src');
      lazyImage.setAttribute('data-src', src);
      lazyImage.classList.add('lazy');
      const icon = root.createElement('div');
      icon.className = 'lazy-icon';
      wrapper.append(lazyImage, icon);
      image.replaceWith(wrapper);
    });
    update();
  };
  const onInitialized = event => {
    instance = event.detail.instance;
    window.lazyLoadInstance = instance;
  };
  const options = {
    elements_selector: '.lazy',
    callback_loaded(element) {
      element.classList.add('loaded');
      const wrapper = element.closest('.lazy-box') || element.parentElement;
      wrapper?.querySelector('.lazy-icon')?.remove();
    }
  };
  window.wrapLazyloadImages = wrapLazyloadImages;
  window.lazyLoadOptions = options;
  window.addEventListener('LazyLoad::Initialized', onInitialized);
  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => [...mutation.addedNodes].some(node =>
      node.nodeType === 1 && (node.matches?.('.lazy') || node.querySelector?.('.lazy'))))) update();
  });
  observer.observe(root.documentElement, { childList: true, subtree: true });
  update();

  return () => {
    disposed = true;
    observer.disconnect();
    window.removeEventListener('LazyLoad::Initialized', onInitialized);
    if (window.wrapLazyloadImages === wrapLazyloadImages) delete window.wrapLazyloadImages;
    if (window.lazyLoadOptions === options) delete window.lazyLoadOptions;
    instance?.destroy();
    if (window.lazyLoadInstance === instance) delete window.lazyLoadInstance;
    instance = null;
  };
}

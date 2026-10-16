'use strict';

(() => {
  const labels = { light: '浅色', dark: '深色', auto: '跟随系统' };
  const button = document.querySelector('.theme-toggle');
  if (button && typeof switchTheme === 'function') {
    const update = () => {
      const mode = document.documentElement.getAttribute('data-theme') || 'auto';
      button.textContent = `外观：${labels[mode] || labels.auto}`;
      button.setAttribute('aria-label', `外观：${labels[mode] || labels.auto}，点击切换`);
    };
    button.hidden = false;
    button.addEventListener('click', () => { switchTheme(); update(); });
    update();
  }
  for (const anchor of document.querySelectorAll('.site-nav-links a')) {
    if (new URL(anchor.href).pathname === location.pathname) {
      anchor.setAttribute('aria-current', 'page');
    }
  }
})();

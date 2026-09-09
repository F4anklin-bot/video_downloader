(() => {
  const key = 'franklins-theme';
  const saved = localStorage.getItem(key) || 'dark';
  const systemLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const resolved = saved === 'auto' ? (systemLight ? 'light' : 'dark') : saved;
  document.documentElement.dataset.theme = resolved === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.themePref = saved;
})();

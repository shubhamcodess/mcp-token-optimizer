// Theme bootstrap kept as an external file: the dashboard's CSP forbids inline scripts.
(function () {
  try {
    var t = localStorage.getItem('mto-theme');
    if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();

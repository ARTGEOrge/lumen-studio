'use strict';
/* Aero window chrome: caption buttons, title text, active/inactive and maximized states. */
(() => {
  const root = document.documentElement, api = window.desktop;
  const titleEl = $('#wintitle');
  const syncTitle = () => { titleEl.textContent = document.title; };
  new MutationObserver(syncTitle).observe(document.querySelector('title'), { childList: true, characterData: true, subtree: true });
  syncTitle();
  const applyState = st => {
    root.classList.toggle('maximized', !!st.maximized);
    root.classList.toggle('inactive', st.focused === false);
    $('#caption [data-c=max]').title = st.maximized ? 'Restore Down' : 'Maximize';
  };
  if (api?.win) {
    root.classList.add('desktop');
    api.win('state').then(st => { root.classList.toggle('native-glass', !!st.glass); applyState(st); });
    api.onWinState(applyState);
    document.querySelectorAll('#caption button').forEach(b => b.onclick = () => api.win(b.dataset.c));
    $('#titlebar').addEventListener('dblclick', e => { if (!e.target.closest('#caption')) api.win('max'); });
  } else {
    // Running in a browser: the page is the "window" over an Aurora backdrop; caption buttons are decorative.
    window.addEventListener('blur', () => root.classList.add('inactive'));
    window.addEventListener('focus', () => root.classList.remove('inactive'));
    document.querySelectorAll('#caption button').forEach(b => b.onclick = () => toast(b.dataset.c === 'close' ? 'Close the browser tab to exit' : 'Window controls work in the desktop app'));
  }
})();

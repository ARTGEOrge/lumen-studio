document.querySelector('.aero-menu').click();
return JSON.stringify({ title: document.title, menus: [...document.querySelectorAll('.aero-menu')].map(m => m.firstChild.textContent), tools: document.querySelectorAll('.aero-tool').length, hist: document.querySelectorAll('#hist .aero-item').length });

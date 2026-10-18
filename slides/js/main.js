'use strict';
/* Lumen Slides — start-up: kit shell, history, drag & drop, initial document. */
(() => {
  S.hist = new Aero.History({ max: 120, onChange: () => { if (!$('#tp-hist').hidden) Aero.renderHistory($('#hist'), S.hist, i => restore(S.hist.go(i))); } });
  Aero.init({
    name: 'Lumen Slides', icon: '../kit/icons/slides.png', doc: 'Untitled',
    dropTarget: $('#work'), dropText: 'Drop a presentation (.lslides, .pptx) to open it, or pictures to insert them',
    onDropFiles: files => {
      const imgs = files.filter(f => /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f.name));
      if (imgs.length && imgs.length === files.length) { IO.insertImageFiles(imgs.map(f => ({ name: f.name, data: f.data, type: f.type }))); return; }
      IO.openFiles(files);
    },
    onSave: () => IO.save(),
  });
  UI.init();
  Editor.init();
  S.doc = Model.newDoc({ theme: 'lumen' });
  S.hist.reset('New', snapshot());
  Aero.setDoc('Untitled', false);
  UI.fillFontSelect();
  changed(true);
  requestAnimationFrame(() => View.fit());
  // first-run welcome text on the empty title slide
  const s = S.doc.slides[0];
  s.objects[0].text = Model.textBody([Model.para('')]);
  Fonts.ready.then(() => { Render.clearMeasureCache(); UI.thumbsSoon(true); requestRender(); });
  window.addEventListener('resize', () => requestRender());
  // show a hint pill until the user does something
  const hint = Aero.el('div', 'aero-pill', 'New presentation · type a title, press <b>Ctrl+M</b> for a new slide, or <button class="aero-btn small" id="w-sample">Open Sample</button> <button class="aero-btn small" id="w-open">Open .pptx…</button>');
  hint.id = 'welcome'; Object.assign(hint.style, { position: 'absolute', left: '50%', bottom: '14px', transform: 'translateX(-50%)', zIndex: 6, display: 'flex', gap: '8px', alignItems: 'center', whiteSpace: 'nowrap' });
  $('#stagewrap').appendChild(hint);
  $('#w-sample').onclick = () => { hint.remove(); IO.openSample(); };
  $('#w-open').onclick = () => { hint.remove(); IO.open(); };
  const drop = () => { if (S.hist.items.length > 1 || S.doc.slides.length > 1) { hint.remove(); clearInterval(t); } };
  const t = setInterval(drop, 1000);
})();

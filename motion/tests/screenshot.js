// Screenshot setup: sample open at 3.6 s (light burst = shape repeater + gradient), Soundtrack audio layer selected,
// timeline scrolled to the top so its waveform shows.
Aero.setDirty(false); await LM.openSample(); await new Promise(r => setTimeout(r, 300));
const c = LM.comp(), b = c.layers.find(l => l.name === 'Light Burst');
['transform'].forEach(g => LM.ui.open.add('insp|' + b.id + '|' + g + '|closed'));
LM.select([c.layers.find(l => l.type === 'audio').id]); LM.setTime(3.6); void b;
await new Promise(r => setTimeout(r, 200));
document.querySelector('.tl-scroll').scrollTop = 0;
const toast = document.querySelector('.aero-toast'); if (toast) toast.style.display = 'none';
await new Promise(r => setTimeout(r, 2500));   // offscreen paints lag under load
return JSON.stringify({ sel: LM.selLayer()?.name, t: LM.st.time });

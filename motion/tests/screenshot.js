// Screenshot setup: sample open, Title layer expanded with its text animator visible.
Aero.setDirty(false); await LM.openSample(); await new Promise(r => setTimeout(r, 300));
const c = LM.comp(), t = c.layers.find(l => l.name === 'Title'), A = t.text.animators[0];
t.expanded = true; ['text', 'anim.' + A.id, 'anim.' + A.id + '.sel'].forEach(g => LM.ui.open.add(t.id + '|' + g));
LM.st.selProps.add(t.id + '|text.tracking');
LM.select([t.id]); LM.setTime(3.6);
await new Promise(r => setTimeout(r, 200)); const row = [...document.querySelectorAll('.tl-row.layer')].find(r => r.dataset.id === t.id); document.querySelector('.tl-scroll').scrollTop = row.offsetTop - 22 * 3;
document.querySelector('.aero-toast').style.display = 'none';
await new Promise(r => setTimeout(r, 300)); document.querySelector('.tl-scroll').scrollTop = row.offsetTop - 22 * 3;
await new Promise(r => setTimeout(r, 800));
return 'ok';

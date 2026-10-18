await new Promise(r => setTimeout(r, 400));
const { doc, assets } = await Sample.build(); setDocument(doc, assets, 'Lumen Product Launch', null); await Render.imagesReady(S.assets);
const M = 'anim';
if (M === 'design') { UI.goSlide(0); UI.selectTab('tp-design'); }
if (M === 'anim') { UI.goSlide(3); UI.selectTab('tp-anim'); const o = curSlide().objects.find(o => o.type === 'roundRect' || o.geom === 'roundRect'); select([o.id]); }
if (M === 'master') { UI.goSlide(1); UI.setMode('master'); }
if (M === 'sorter') { UI.setSorter(true); }
await new Promise(r => setTimeout(r, 300)); UI.thumbsSoon(true); await new Promise(r => setTimeout(r, 400));
return 'ok';

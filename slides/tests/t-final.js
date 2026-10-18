await new Promise(r => setTimeout(r, 500));
const { doc, assets } = await Sample.build(); setDocument(doc, assets, 'Lumen Product Launch', null); await Render.imagesReady(S.assets);
UI.goSlide(3); await new Promise(r => setTimeout(r, 200));
const o = curSlide().objects.find(o => o.geom === 'roundRect'); select([o.id]);
await new Promise(r => setTimeout(r, 300)); UI.thumbsSoon(true); await new Promise(r => setTimeout(r, 500));
return 'ok';

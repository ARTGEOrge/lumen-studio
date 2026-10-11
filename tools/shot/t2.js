const t=document.querySelector('.aero-tool'); const r=t.getBoundingClientRect(); const tb=document.querySelector('.aero-toolbox').getBoundingClientRect();
return JSON.stringify({tool:[r.x,r.y,r.width,r.height], box:[tb.x,tb.y,tb.width,tb.height], html: document.querySelector('.aero-toolbox').innerHTML.slice(0,200)});

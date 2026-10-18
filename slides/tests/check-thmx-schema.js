// Sanity check of the schema-order tables against PowerPoint-authored XML (Office theme packages).
const fs = require('fs'), path = require('path'), fflate = require('../vendor/fflate.js'), Schema = require('./schema-order.js');
const dir = 'C:/Program Files/Microsoft Office/root/Document Themes 16'; let n = 0; const errs = new Map();
for (const f of fs.readdirSync(dir).filter(f => /\.thmx$/i.test(f))) {
  const z = fflate.unzipSync(fs.readFileSync(path.join(dir, f)));
  for (const [p, b] of Object.entries(z)) if (/(slideMaster|slideLayout|theme)\d*\.xml$/.test(p)) { n++; for (const e of Schema.check(fflate.strFromU8(b), p)) { const k = e.replace(/^[^:]+: /, ''); errs.set(k, (errs.get(k) || 0) + 1); } }
}
console.log(`${n} PowerPoint-authored parts checked; distinct findings: ${errs.size}`);
for (const [k, v] of [...errs].slice(0, 30)) console.log(v, k.slice(0, 200));

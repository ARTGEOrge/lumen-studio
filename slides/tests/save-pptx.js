// Reads tools/shot output on stdin (t-export.js), prints the checks and writes the browser-made sample.pptx.
const fs = require('fs'), path = require('path');
let s = ''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => {
  const line = s.split('\n').find(l => l.startsWith('RESULT ')); s.split('\n').filter(l => l && !l.startsWith('RESULT ')).forEach(l => console.log(l.slice(0, 400)));
  if (!line) { console.log('no RESULT'); process.exit(1); }
  const r = JSON.parse(line.slice(7));
  console.log(`browser export checks: ${r.pass} passed, ${r.fail.length} failed`); r.fail.forEach(f => console.log('FAIL', JSON.stringify(f).slice(0, 600)));
  if (r.pptx) { const out = path.join(__dirname, 'out', 'sample.pptx'); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, Buffer.from(r.pptx, 'base64')); console.log('wrote', out); }
});

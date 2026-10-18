// reads shot output on stdin, writes the RESULT data URL to the file given as argv[2]
let s = ''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => {
  const lines = s.split('\n'); const r = lines.find(l => l.startsWith('RESULT ')); lines.filter(l => !l.startsWith('RESULT ')).forEach(l => l.trim() && console.log(l.slice(0, 300)));
  if (!r) { console.log('no RESULT'); return; }
  const v = r.slice(7); const m = /^"?data:image\/png;base64,([^"]+)"?$/.exec(v);
  if (m) { require('fs').writeFileSync(process.argv[2], Buffer.from(m[1], 'base64')); console.log('wrote', process.argv[2]); } else console.log('RESULT', v.slice(0, 2000));
});

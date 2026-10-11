// Copies browser builds of third-party libraries into src/vendor (run automatically on npm install)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'src', 'vendor');
fs.mkdirSync(path.join(out, 'libraw'), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/ag-psd/dist/bundle.js'), path.join(out, 'ag-psd.js'));
const lr = path.join(root, 'node_modules/libraw-wasm/dist');
for (const f of fs.readdirSync(lr)) if (/\.(js|wasm)$/.test(f)) fs.copyFileSync(path.join(lr, f), path.join(out, 'libraw', f));
fs.copyFileSync(path.join(root, 'node_modules/ag-psd/LICENSE'), path.join(out, 'ag-psd.LICENSE'));
console.log('vendor files copied (keep libraw/NOTICE.txt)');

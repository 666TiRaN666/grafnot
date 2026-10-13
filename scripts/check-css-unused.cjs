const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'src', 'index.css');
const srcDir = path.join(__dirname, '..', 'src');
const css = fs.readFileSync(cssPath, 'utf8');
const defined = [...new Set([...css.matchAll(/\.g-[A-Za-z0-9_-]+/g)].map((m) => m[0].slice(1)))];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(srcDir);
let blob = '';
for (const f of files) blob += '\n' + fs.readFileSync(f, 'utf8');
const used = new Set([...blob.matchAll(/g-[A-Za-z0-9_-]+/g)].map((m) => m[0]));
const unused = defined.filter((c) => !used.has(c)).sort();
console.log(`defined .g- classes: ${defined.length}`);
console.log(`used .g- classes: ${used.size}`);
console.log(`unused .g- classes: ${unused.length}`);
for (const u of unused) console.log('UNUSED ' + u);
const mode = process.argv[2] || 'report';
if (mode === 'enforce' && unused.length > 0) process.exit(1);

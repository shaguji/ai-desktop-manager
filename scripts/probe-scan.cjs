// Real (read-only) scan probe: verifies classification across BOTH desktop roots.
const os = require('node:os');
const path = require('node:path');
const { scanDesktop, desktopRoots } = require('./_organizer.probe.cjs');

const userDesktop = path.join(os.homedir(), 'Desktop');
console.log('roots:', desktopRoots(userDesktop));

const r = scanDesktop(userDesktop);
console.log('organized:', r.organized, 'total:', r.total);
for (const g of r.categories) {
  if (g.items.length === 0) continue;
  console.log(`\n[${g.label}] ${g.items.length}`);
  for (const it of g.items.slice(0, 40)) console.log('  -', it.name, '  <-', it.path);
}

// Headless screenshot of one landmark in the dev gallery (needs `npm run dev` on port 5311).
//
//   node scripts/snap.mjs <key> [--az=35] [--view=iso|side|top] [--night] [--zoom=1] [--t=3] [--out=path.png]
//
// Prints a JSON line with the output path, triangle count, size and any console errors.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const PW = process.env.PLAYWRIGHT_CORE || '/Users/afthab/claude/afthab-edit/engine/node_modules/playwright-core/index.mjs';
const { chromium } = await import(PW);

const args = process.argv.slice(2);
const key = args.find((a) => !a.startsWith('--'));
if (!key) { console.error('usage: node scripts/snap.mjs <key> [--az=35] [--view=iso|side|top] [--night] [--zoom=1] [--out=file.png]'); process.exit(2); }
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const view = opt.view ?? 'iso';
const night = opt.night ? 1 : 0;
const out = resolve(opt.out ?? `reports/_tmp/${key}-${view}${night ? '-night' : ''}-${opt.az ?? 35}.png`);
mkdirSync(dirname(out), { recursive: true });

const port = process.env.PORT || 5311;
const url = `http://[::1]:${port}/landmarks.html?key=${key}&view=${view}&night=${night}&az=${opt.az ?? 35}&zoom=${opt.zoom ?? 1}&t=${opt.t ?? 3}`;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: Number(opt.w ?? 1100), height: Number(opt.h ?? 850) }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  const stats = await page.evaluate(() => window.__stats);
  await page.screenshot({ path: out });
  console.log(JSON.stringify({ out, url, ...stats, errors }));
} finally {
  await browser.close();
}

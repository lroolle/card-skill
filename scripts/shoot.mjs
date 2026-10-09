// shoot.mjs -- screenshot a board page for review. Dev tool, not part of the skill.
//   node scripts/shoot.mjs <url-or-html-path> <out-prefix> [--widths 1440,390] [--dark] [--touch] [--full] [--eval "js"]
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  ({ chromium } = require(path.join(process.env.HOME, '.npm-global/lib/node_modules/playwright')));
}

const [target, out, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf('--' + k); return i < 0 ? d : rest[i + 1]; };
const widths = opt('widths', '1440,390').split(',').map(Number);
const dark = rest.includes('--dark');
const full = rest.includes('--full');
const touch = rest.includes('--touch');
const evalJs = opt('eval', '');
const url = /^https?:|^file:/.test(target) ? target : pathToFileURL(path.resolve(target)).href;

const browser = await chromium.launch();
for (const w of widths) {
  const page = await browser.newPage({ viewport: { width: w, height: w < 600 ? 844 : 900 }, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForTimeout(150);
  if (evalJs) { await page.evaluate(evalJs); await page.waitForTimeout(250); }
  const file = `${out}-${w}${touch ? '-touch' : ''}${dark ? '-dark' : ''}.png`;
  await page.screenshot({ path: file, fullPage: full });
  console.log(file + (errors.length ? '  ERRORS: ' + errors.join(' | ') : ''));
  await page.close();
}
await browser.close();

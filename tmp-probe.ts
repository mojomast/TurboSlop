const pw = (await import('/tmp/opencode/node_modules/playwright-core/index.js')) as { chromium?: any; default?: { chromium?: any } };
const chromium = (pw.chromium ?? pw.default?.chromium);
const file = process.argv[2]!;
const w = Number(process.argv[3] ?? 390);
const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome` });
const page = await browser.newPage({ viewport: { width: w, height: 844 } });
await page.addInitScript({ content: 'globalThis.__name = globalThis.__name || ((f) => f);' });
await page.goto(`file://${process.cwd()}/${file}`, { waitUntil: 'load' });
const out = await page.evaluate((vw: number) => {
  const bad: { tag: string; cls: string; right: number; width: number; text: string }[] = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > vw + 2 || r.left < -2) {
      bad.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 48), right: Math.round(r.right), width: Math.round(r.width), text: (el.textContent ?? '').trim().slice(0, 30) });
    }
  }
  return { docWidth: document.documentElement.scrollWidth, count: bad.length, worst: bad.sort((a, b) => b.right - a.right).slice(0, 8) };
}, w);
console.log(file, '@', w, '→ doc', out.docWidth, '| offenders', out.count);
for (const b of out.worst) console.log('   ', b.right.toString().padStart(5), b.width.toString().padStart(5), b.tag, b.cls.padEnd(30), JSON.stringify(b.text));
await browser.close();
